import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

export async function GET() {
  const results: Record<string, string> = {};

  // Check common paths
  const paths = [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/var/task/ffmpeg",
    "/tmp/ffmpeg",
  ];

  for (const p of paths) {
    results[p] = fs.existsSync(p) ? "EXISTS" : "not found";
  }

  // Try which
  try {
    const { stdout } = await execAsync("which ffmpeg");
    results["which ffmpeg"] = stdout.trim();
  } catch (e) {
    results["which ffmpeg"] = "not found";
  }

  // Try version
  try {
    const { stdout } = await execAsync("ffmpeg -version 2>&1 | head -1");
    results["ffmpeg -version"] = stdout.trim();
  } catch (e) {
    results["ffmpeg -version"] = String(e);
  }

  // List /usr/bin
  try {
    const { stdout } = await execAsync("ls /usr/bin | grep ff");
    results["/usr/bin ff* files"] = stdout.trim();
  } catch {
    results["/usr/bin ff* files"] = "none";
  }

  return Response.json(results);
}
