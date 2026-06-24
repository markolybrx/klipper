import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import os from "os";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function getFfmpegPath(): string {
  const candidates = [
    path.join(process.cwd(), "ffmpeg-bin", "ffmpeg"),
    "/var/task/apps/web/ffmpeg-bin/ffmpeg",
    "/var/task/ffmpeg-bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { fs.chmodSync(p, 0o755); } catch {}
      console.log("[klipper] Using ffmpeg at:", p);
      return p;
    }
  }
  throw new Error("ffmpeg binary not found in deployment.");
}

function getCropFilter(layout: string): string {
  switch (layout) {
    case "9:16":
      return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920";
    case "1:1":
      return "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=1080:1080";
    default:
      return "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black";
  }
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  console.log("[klipper] Downloading:", url.substring(0, 100));

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  console.log("[klipper] Content-Type:", contentType);

  const isVideo = contentType.includes("video/") || contentType.includes("application/octet-stream");
  if (!isVideo) {
    throw new Error(
      `The URL did not return a video file — it returned "${contentType}". ` +
      "This usually means the URL is a webpage, not a direct video link. " +
      "Please paste a direct .mp4 URL or upload a file instead. " +
      "Facebook, Instagram, and TikTok share links are not supported — use Upload File."
    );
  }

  const writeStream = fs.createWriteStream(destPath);
  const readable = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
  await new Promise<void>((resolve, reject) => {
    readable.pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    readable.on("error", reject);
  });

  const stat = fs.statSync(destPath);
  console.log("[klipper] Downloaded:", stat.size, "bytes");

  if (stat.size < 10000) {
    throw new Error(`Downloaded file is too small (${stat.size} bytes) — likely not a valid video.`);
  }
}

function send(controller: ReadableStreamDefaultController, encoder: TextEncoder, data: object) {
  try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, sourceType, sourceUrl, storagePath, prompt, duration, layout } = body;
  console.log("[klipper] /api/generate called:", { sessionId, sourceType, duration, layout });

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

        emit({ type: "progress", percent: 2, stage: "Initializing..." });
        const ffmpegBin = getFfmpegPath();
        const sourcePath = path.join(tmpDir, "source.mp4");
        const supabase = getAdminClient();

        emit({ type: "progress", percent: 8, stage: "Fetching video source..." });

        if (sourceType === "file") {
          const { data: signedData, error: signErr } = await supabase.storage
            .from("source-videos")
            .createSignedUrl(storagePath, 300);
          if (signErr || !signedData) throw new Error("Could not access uploaded file.");
          await downloadToFile(signedData.signedUrl, sourcePath);

        } else if (sourceType === "url") {
          const isYouTube = /youtube\.com|youtu\.be/i.test(sourceUrl);
          const isSocialShare = /facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com/i.test(sourceUrl);

          if (isSocialShare) {
            throw new Error(
              "Social media share links (Facebook, Instagram, TikTok, Twitter) cannot be downloaded directly " +
              "due to platform restrictions. Please download the video first and use Upload File instead."
            );
          }

          if (isYouTube) {
            emit({ type: "progress", percent: 10, stage: "Fetching YouTube video..." });
            try {
              const ytdl = require("@distube/ytdl-core");
              const info = await ytdl.getInfo(sourceUrl);
              const format = ytdl.chooseFormat(info.formats, {
                quality: "18",
                filter: "audioandvideo",
              });
              if (!format?.url) throw new Error("No downloadable format found.");
              await downloadToFile(format.url, sourcePath);
            } catch (ytErr: unknown) {
              const msg = ytErr instanceof Error ? ytErr.message : "";
              if (msg.includes("platform restrictions") || msg.includes("webpage")) throw ytErr;
              throw new Error(
                "YouTube videos cannot be downloaded from cloud servers due to bot detection. " +
                "Download the video and use Upload File instead."
              );
            }
          } else {
            emit({ type: "progress", percent: 10, stage: "Downloading video..." });
            await downloadToFile(sourceUrl, sourcePath);
          }
        } else {
          throw new Error("Invalid source type.");
        }

        // Upload to Gemini
        emit({ type: "progress", percent: 28, stage: "Uploading to Gemini for analysis..." });
        const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
        const uploadResult = await fileManager.uploadFile(sourcePath, {
          mimeType: "video/mp4",
          displayName: `klipper-${sessionId}`,
        });
        console.log("[klipper] Gemini upload:", uploadResult.file.name);

        // Poll for processing
        emit({ type: "progress", percent: 38, stage: "Gemini is processing your video..." });
        let geminiFile = await fileManager.getFile(uploadResult.file.name);
        let attempts = 0;
        const maxAttempts = 18;

        while (geminiFile.state === FileState.PROCESSING && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 5000));
          geminiFile = await fileManager.getFile(uploadResult.file.name);
          attempts++;
          const pollPct = 38 + Math.round((attempts / maxAttempts) * 10);
          emit({
            type: "progress",
            percent: pollPct,
            stage: `Gemini processing... (${attempts * 5}s)`,
          });
          console.log("[klipper] Gemini state:", geminiFile.state, "attempt:", attempts);
        }

        if (geminiFile.state === FileState.FAILED) {
          try { await fileManager.deleteFile(uploadResult.file.name); } catch {}
          throw new Error(
            "Gemini failed to process this video. The file may be corrupted, " +
            "in an unsupported format, or too large. Try a different video or upload an MP4 file directly."
          );
        }

        if (geminiFile.state !== FileState.ACTIVE) {
          try { await fileManager.deleteFile(uploadResult.file.name); } catch {}
          throw new Error("Gemini timed out processing the video. Try a shorter video (under 5 minutes).");
        }

        // Analyze
        emit({ type: "progress", percent: 50, stage: "AI is analyzing your video..." });
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        const durationLabel = duration < 60 ? `${duration} seconds` : `${duration / 60} minutes`;

        const analysisPrompt = `You are a short-form video clip selector for social media content creators.

Analyze this video and identify the 5 best moments to clip.
${prompt ? `Creator instruction: ${prompt}` : "Select the most engaging, high-energy, or insightful moments."}

Return ONLY a valid JSON array — no markdown, no code blocks, raw JSON only:

[
  {
    "start_time": 12.5,
    "end_time": 42.5,
    "hook_score": 0.92,
    "rationale": "One sentence why this moment is engaging"
  }
]

Rules:
- start_time and end_time are in seconds
- hook_score is 0.0 to 1.0
- end_time - start_time = approximately ${duration} seconds (${durationLabel})
- Return exactly 5 clips ordered by hook_score descending
- If video is too short for 5 non-overlapping clips, overlapping is acceptable`;

        const result = await model.generateContent([
          { fileData: { mimeType: "video/mp4", fileUri: geminiFile.uri } },
          { text: analysisPrompt },
        ]);

        const rawText = result.response.text().trim();
        console.log("[klipper] Gemini response:", rawText.substring(0, 300));
        const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        let timestamps: Array<{
          start_time: number;
          end_time: number;
          hook_score: number;
          rationale: string;
        }>;

        try {
          const parsed = JSON.parse(cleaned);
          if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Empty array");
          timestamps = parsed.slice(0, 5);
        } catch {
          throw new Error("AI returned an unreadable response. Please try again.");
        }

        try { await fileManager.deleteFile(uploadResult.file.name); } catch {}
        console.log("[klipper] Timestamps:", timestamps.length);

        // Render clips
        const clips = [];

        for (let i = 0; i < timestamps.length; i++) {
          const ts = timestamps[i];
          const pct = 60 + Math.round((i / timestamps.length) * 32);
          emit({
            type: "progress",
            percent: pct,
            stage: `Rendering clip ${i + 1} of ${timestamps.length}...`,
          });

          const clipPath = path.join(tmpDir, `clip-${i + 1}.mp4`);
          const clipDuration = Math.max(1, Math.round(ts.end_time - ts.start_time));

          const ffmpegArgs = [
            "-ss", String(Math.max(0, ts.start_time)),
            "-i", sourcePath,
            "-t", String(clipDuration),
            "-vf", getCropFilter(layout),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "28",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-y",
            clipPath,
          ];

          await execFileAsync(ffmpegBin, ffmpegArgs);
          emit({ type: "progress", percent: pct + 4, stage: `Saving clip ${i + 1}...` });

          const clipBuffer = fs.readFileSync(clipPath);
          const clipStoragePath = `${sessionId}/clip-${i + 1}.mp4`;

          const { error: uploadErr } = await supabase.storage
            .from("rendered-clips")
            .upload(clipStoragePath, clipBuffer, { contentType: "video/mp4", upsert: true });

          if (uploadErr) throw new Error(`Failed to save clip ${i + 1}: ${uploadErr.message}`);

          const { data: signedData, error: signErr } = await supabase.storage
            .from("rendered-clips")
            .createSignedUrl(clipStoragePath, 7200);

          if (signErr || !signedData) throw new Error(`Failed to generate download URL for clip ${i + 1}.`);

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

          console.log(`[klipper] Clip ${i + 1} done`);
        }

        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

        emit({ type: "progress", percent: 100, stage: "Done" });
        emit({ type: "complete", clips });
        console.log("[klipper] Complete:", clips.length, "clips");

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
        console.log("[klipper] Error:", msg);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        emit({ type: "error", message: msg });
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
