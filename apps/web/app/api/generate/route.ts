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
import https from "https";
import http from "http";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const COBALT_API = process.env.COBALT_INSTANCE_URL ?? "https://api.cobalt.tools";

const SUPPORTED_PLATFORMS = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "facebook.com", "fb.watch",
  "twitter.com", "x.com",
  "vimeo.com",
  "twitch.tv",
];

function detectPlatform(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    for (const p of SUPPORTED_PLATFORMS) {
      if (hostname.includes(p)) return p;
    }
    return null;
  } catch {
    return null;
  }
}

function isDirectVideoUrl(url: string): boolean {
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
    return ["mp4", "mov", "webm", "avi", "mkv"].includes(ext ?? "");
  } catch {
    return false;
  }
}

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

// Use Node's native http/https to download — handles chunked transfer correctly
// where fetch API fails in Vercel serverless context
function downloadWithNode(url: string, destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const writeStream = fs.createWriteStream(destPath);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Range": "bytes=0-",
        "Referer": "https://cobalt.tools/",
        "Origin": "https://cobalt.tools",
        "Connection": "keep-alive",
      },
    };

    const req = client.request(options, (res) => {
      console.log("[klipper] Node HTTP status:", res.statusCode);
      console.log("[klipper] Node HTTP headers:", JSON.stringify({
        "content-type": res.headers["content-type"],
        "content-length": res.headers["content-length"],
        "transfer-encoding": res.headers["transfer-encoding"],
      }));

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} downloading video`));
        return;
      }

      res.pipe(writeStream);

      writeStream.on("finish", () => {
        const size = fs.statSync(destPath).size;
        console.log("[klipper] Node download complete:", size, "bytes");
        resolve(size);
      });

      writeStream.on("error", reject);
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("Download timed out after 60 seconds"));
    });
    req.end();
  });
}

async function resolveVideoUrl(sourceUrl: string): Promise<{ url: string; isTunnel: boolean }> {
  if (isDirectVideoUrl(sourceUrl)) {
    return { url: sourceUrl, isTunnel: false };
  }

  const platform = detectPlatform(sourceUrl);
  if (!platform) {
    throw new Error(
      "Unrecognized URL. Paste a direct .mp4 URL or a link from YouTube, TikTok, Instagram, Facebook, or Twitter."
    );
  }

  console.log("[klipper] Resolving via Cobalt, platform:", platform);

  const cobaltRes = await fetch(`${COBALT_API}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      url: sourceUrl,
      videoQuality: "720",
      downloadMode: "auto",
    }),
  });

  if (!cobaltRes.ok) {
    const errText = await cobaltRes.text().catch(() => "");
    console.log("[klipper] Cobalt error:", cobaltRes.status, errText.substring(0, 200));
    throw new Error(
      `Could not fetch video from ${platform} (status ${cobaltRes.status}). Try uploading as a file.`
    );
  }

  const cobaltData = await cobaltRes.json();
  console.log("[klipper] Cobalt status:", cobaltData.status);

  if (cobaltData.status === "error") {
    throw new Error(
      `Could not download from ${platform}: ${cobaltData.error?.code ?? "unknown"}. ` +
      "The video may be private or unavailable."
    );
  }

  if (cobaltData.status === "picker") {
    const videoItem = cobaltData.picker?.find(
      (item: { type: string; url: string }) => item.type === "video"
    );
    if (videoItem?.url) return { url: videoItem.url, isTunnel: true };
    throw new Error("Could not select a video stream. Try uploading as a file.");
  }

  if (cobaltData.status === "redirect" || cobaltData.status === "tunnel") {
    if (!cobaltData.url) throw new Error("Cobalt returned no download URL.");
    console.log("[klipper] Cobalt URL:", cobaltData.url.substring(0, 80));
    return {
      url: cobaltData.url,
      isTunnel: cobaltData.status === "tunnel",
    };
  }

  throw new Error(`Unexpected Cobalt response: ${cobaltData.status}`);
}

async function downloadVideoToFile(
  url: string,
  destPath: string,
  isTunnel: boolean
): Promise<void> {
  console.log("[klipper] Downloading video, isTunnel:", isTunnel, "url:", url.substring(0, 80));

  let size: number;

  if (isTunnel) {
    // Use Node native HTTP for tunnel URLs — fetch API strips body in Vercel
    size = await downloadWithNode(url, destPath);
  } else {
    // Direct video URL — use fetch
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    console.log("[klipper] Content-Type:", contentType);

    const isVideo =
      contentType.includes("video/") ||
      contentType.includes("application/octet-stream") ||
      contentType.includes("binary/octet-stream");

    if (!isVideo) {
      throw new Error(
        `The URL returned "${contentType}" instead of a video. ` +
        "Try using a direct .mp4 URL or upload a file."
      );
    }

    if (!response.body) throw new Error("Empty response body.");

    const writeStream = fs.createWriteStream(destPath);
    const readable = Readable.fromWeb(response.body as import("stream/web").ReadableStream);

    await new Promise<void>((resolve, reject) => {
      readable.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      readable.on("error", reject);
    });

    size = fs.statSync(destPath).size;
    console.log("[klipper] Downloaded:", size, "bytes");
  }

  if (size < 10000) {
    throw new Error(
      `Downloaded file is too small (${size} bytes). ` +
      "The platform may have blocked this request. Try uploading the video as a file instead."
    );
  }
}

function send(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  data: object
) {
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch {}
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

        if (sourceType === "file") {
          emit({ type: "progress", percent: 8, stage: "Fetching uploaded video..." });
          const { data: signedData, error: signErr } = await supabase.storage
            .from("source-videos")
            .createSignedUrl(storagePath, 300);
          if (signErr || !signedData) throw new Error("Could not access uploaded file.");
          await downloadVideoToFile(signedData.signedUrl, sourcePath, false);

        } else if (sourceType === "url") {
          emit({ type: "progress", percent: 8, stage: "Resolving video URL..." });
          const resolved = await resolveVideoUrl(sourceUrl);
          emit({ type: "progress", percent: 18, stage: "Downloading video..." });
          await downloadVideoToFile(resolved.url, sourcePath, resolved.isTunnel);

        } else {
          throw new Error("Invalid source type.");
        }

        emit({ type: "progress", percent: 28, stage: "Uploading to Gemini for analysis..." });
        const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
        const uploadResult = await fileManager.uploadFile(sourcePath, {
          mimeType: "video/mp4",
          displayName: `klipper-${sessionId}`,
        });
        console.log("[klipper] Gemini upload:", uploadResult.file.name);

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
            "Gemini failed to process this video. Try uploading an MP4 file directly."
          );
        }

        if (geminiFile.state !== FileState.ACTIVE) {
          try { await fileManager.deleteFile(uploadResult.file.name); } catch {}
          throw new Error("Gemini timed out. Try a shorter video (under 5 minutes).");
        }

        emit({ type: "progress", percent: 50, stage: "AI is analyzing your video..." });
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const durationLabel = duration < 60
          ? `${duration} seconds`
          : `${duration / 60} minutes`;

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
        const cleaned = rawText
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();

        let timestamps: Array<{
          start_time: number;
          end_time: number;
          hook_score: number;
          rationale: string;
        }>;

        try {
          const parsed = JSON.parse(cleaned);
          if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Empty");
          timestamps = parsed.slice(0, 5);
        } catch {
          throw new Error("AI returned an unreadable response. Please try again.");
        }

        try { await fileManager.deleteFile(uploadResult.file.name); } catch {}
        console.log("[klipper] Timestamps:", timestamps.length);

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

          if (signErr || !signedData) throw new Error(`Failed to get URL for clip ${i + 1}.`);

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
