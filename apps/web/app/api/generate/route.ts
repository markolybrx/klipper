import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { execFile, chmodSync } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import os from "os";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function getFfmpegPath(): string {
  const p = require("ffmpeg-static") as string | null;
  if (!p) throw new Error("ffmpeg binary not found in bundle.");
  try { chmodSync(p, 0o755); } catch {}
  return p;
}

function send(controller: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

function getCropFilter(layout: string): string {
  switch (layout) {
    case "9:16":
      return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920";
    case "1:1":
      return "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=1080:1080";
    case "16:9":
    default:
      return "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black";
  }
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
  const writeStream = fs.createWriteStream(destPath);
  const readable = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
  await new Promise<void>((resolve, reject) => {
    readable.pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    readable.on("error", reject);
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, sourceType, sourceUrl, storagePath, prompt, duration, layout } = body;

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Missing sessionId." }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => send(controller, encoder, data);
      const tmpDir = path.join(os.tmpdir(), `klipper-${sessionId}`);

      try {
        fs.mkdirSync(tmpDir, { recursive: true });
        const sourcePath = path.join(tmpDir, "source.mp4");
        const supabase = getAdminClient();
        const ffmpegBin = getFfmpegPath();

        // Stage 1 — Download source
        emit({ type: "progress", percent: 5, stage: "Fetching video source..." });

        if (sourceType === "file") {
          const { data: signedData, error: signErr } = await supabase.storage
            .from("source-videos")
            .createSignedUrl(storagePath, 300);
          if (signErr || !signedData) throw new Error("Could not access uploaded file.");
          await downloadToFile(signedData.signedUrl, sourcePath);
        } else if (sourceType === "url") {
          const isYouTube = /youtube\.com|youtu\.be/i.test(sourceUrl);
          if (isYouTube) {
            const ytdl = require("@distube/ytdl-core");
            emit({ type: "progress", percent: 10, stage: "Downloading YouTube video..." });
            await new Promise<void>((resolve, reject) => {
              const writeStream = fs.createWriteStream(sourcePath);
              const ytStream = ytdl(sourceUrl, { quality: "18" }); // 360p mp4
              ytStream.pipe(writeStream);
              writeStream.on("finish", resolve);
              ytStream.on("error", reject);
              writeStream.on("error", reject);
            });
          } else {
            await downloadToFile(sourceUrl, sourcePath);
          }
        } else {
          throw new Error("Invalid source type.");
        }

        if (!fs.existsSync(sourcePath)) throw new Error("Video download failed — file not found.");

        // Stage 2 — Upload to Gemini Files API
        emit({ type: "progress", percent: 25, stage: "Uploading to Gemini..." });

        const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
        const uploadResult = await fileManager.uploadFile(sourcePath, {
          mimeType: "video/mp4",
          displayName: `klipper-${sessionId}`,
        });

        // Stage 3 — Wait for Gemini processing
        emit({ type: "progress", percent: 35, stage: "Gemini is processing video..." });

        let geminiFile = await fileManager.getFile(uploadResult.file.name);
        let attempts = 0;
        while (geminiFile.state === FileState.PROCESSING && attempts < 60) {
          await new Promise((r) => setTimeout(r, 5000));
          geminiFile = await fileManager.getFile(uploadResult.file.name);
          attempts++;
        }
        if (geminiFile.state !== FileState.ACTIVE) {
          throw new Error("Gemini video processing timed out. Try a shorter video.");
        }

        // Stage 4 — Analyze with Gemini
        emit({ type: "progress", percent: 50, stage: "AI is analyzing your video..." });

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        const analysisPrompt = `You are a short-form video clip selector for social media content creators.

Analyze this video and identify the 5 best moments to clip for social media.
${prompt ? `Creator's focus: ${prompt}` : "Select the most engaging, high-energy, or insightful moments that would perform well on TikTok, Reels, or Shorts."}

Return ONLY a valid JSON array. No markdown, no code blocks, no explanation — raw JSON only.
Each clip should be approximately ${duration} seconds long (${duration}s).

[
  {
    "start_time": 12.5,
    "end_time": 42.5,
    "hook_score": 0.92,
    "rationale": "One sentence explaining why this moment is engaging"
  }
]

Rules:
- start_time and end_time are in seconds with decimals allowed
- hook_score is 0.0 to 1.0 (1.0 = extremely engaging)
- Clips must not overlap each other
- end_time minus start_time must equal approximately ${duration} seconds
- Return exactly 5 clips ordered by hook_score from highest to lowest
- If the video is shorter than needed for 5 non-overlapping clips, use overlapping clips`;

        const result = await model.generateContent([
          { fileData: { mimeType: "video/mp4", fileUri: uploadResult.file.uri } },
          { text: analysisPrompt },
        ]);

        const rawText = result.response.text().trim();
        const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        let timestamps: Array<{ start_time: number; end_time: number; hook_score: number; rationale: string }>;
        try {
          const parsed = JSON.parse(cleaned);
          if (!Array.isArray(parsed)) throw new Error("Not an array");
          timestamps = parsed.slice(0, 5);
        } catch {
          throw new Error("AI returned an unreadable response. Please try again.");
        }

        // Delete Gemini file to save quota
        try { await fileManager.deleteFile(uploadResult.file.name); } catch {}

        // Stage 5 — Render clips
        const clips = [];
        for (let i = 0; i < timestamps.length; i++) {
          const ts = timestamps[i];
          const pct = 60 + Math.round((i / timestamps.length) * 30);
          emit({ type: "progress", percent: pct, stage: `Rendering clip ${i + 1} of ${timestamps.length}...` });

          const clipPath = path.join(tmpDir, `clip-${i + 1}.mp4`);
          const clipDuration = Math.round(ts.end_time - ts.start_time);

          const ffmpegArgs = [
            "-ss", String(ts.start_time),
            "-i", sourcePath,
            "-t", String(clipDuration),
            "-vf", getCropFilter(layout),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-y",
            clipPath,
          ];

          await execFileAsync(ffmpegBin, ffmpegArgs);

          emit({ type: "progress", percent: pct + 4, stage: `Uploading clip ${i + 1}...` });

          const clipBuffer = fs.readFileSync(clipPath);
          const clipStoragePath = `${sessionId}/clip-${i + 1}.mp4`;

          const { error: uploadErr } = await supabase.storage
            .from("rendered-clips")
            .upload(clipStoragePath, clipBuffer, { contentType: "video/mp4", upsert: true });

          if (uploadErr) throw new Error(`Failed to save clip ${i + 1}: ${uploadErr.message}`);

          const { data: signedData, error: signErr } = await supabase.storage
            .from("rendered-clips")
            .createSignedUrl(clipStoragePath, 7200); // 2 hour URL

          if (signErr || !signedData) throw new Error(`Failed to generate URL for clip ${i + 1}.`);

          try { fs.unlinkSync(clipPath); } catch {}

          clips.push({
            id: i + 1,
            signedUrl: signedData.signedUrl,
            storagePath: clipStoragePath,
            hookScore: ts.hook_score,
            rationale: ts.rationale,
            startTime: ts.start_time,
            endTime: ts.end_time,
          });
        }

        // Cleanup
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

        emit({ type: "progress", percent: 100, stage: "Done" });
        emit({ type: "complete", clips });

      } catch (err: unknown) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "An unexpected error occurred.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
