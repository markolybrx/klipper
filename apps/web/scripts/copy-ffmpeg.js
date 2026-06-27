const fs = require("fs");
const path = require("path");

const destDir = path.join(__dirname, "..", "ffmpeg-bin");
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

const destPath = path.join(destDir, "ffmpeg");

// Try ffmpeg-static
try {
  const ffmpegStatic = require("ffmpeg-static");
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    fs.copyFileSync(ffmpegStatic, destPath);
    fs.chmodSync(destPath, 0o755);
    console.log("[klipper] ffmpeg binary copied to ffmpeg-bin/ffmpeg from:", ffmpegStatic);
    console.log("[klipper] Binary size:", fs.statSync(destPath).size, "bytes");
    process.exit(0);
  }
} catch (e) {
  console.log("[klipper] ffmpeg-static not available:", e.message);
}

console.error("[klipper] Could not locate ffmpeg binary to copy.");
process.exit(1);
