"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./results.module.css";

interface Clip {
  id: number;
  signedUrl: string;
  hookScore: number;
  rationale: string;
  startTime: number;
  endTime: number;
}

export default function ResultsPage() {
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>([]);
  const [layout, setLayout] = useState<string>("9:16");
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    const clipsData = sessionStorage.getItem("klipper_clips");
    const layoutData = sessionStorage.getItem("klipper_layout");
    if (!clipsData) { router.replace("/"); return; }
    try {
      setClips(JSON.parse(clipsData));
      setLayout(layoutData ?? "9:16");
    } catch {
      router.replace("/");
    }
  }, [router]);

  async function downloadClip(clip: Clip, index: number) {
    setDownloading(index);
    try {
      const response = await fetch(clip.signedUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `klipper-clip-${clip.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  }

  async function downloadAll() {
    setDownloadingAll(true);
    for (let i = 0; i < clips.length; i++) {
      await downloadClip(clips[i], -1);
      if (i < clips.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
    setDownloadingAll(false);
  }

  const isPortrait = layout === "9:16";
  const isSquare = layout === "1:1";

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Klipper</span>
        <div className={styles.headerActions}>
          <button
            className={styles.downloadAllBtn}
            onClick={downloadAll}
            disabled={downloadingAll || clips.length === 0}
          >
            {downloadingAll ? "Downloading..." : `Download all ${clips.length} clips`}
          </button>
          <button
            className={styles.startOver}
            onClick={() => { sessionStorage.clear(); router.push("/"); }}
          >
            Start over
          </button>
        </div>
      </header>

      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Your clips are ready</h1>
        <p className={styles.pageSubtitle}>
          {clips.length} clips generated and ranked by hook score. Preview each one before downloading.
        </p>
      </div>

      <div className={`${styles.clipsGrid} ${isPortrait ? styles.portraitGrid : ""}`}>
        {clips.map((clip, index) => (
          <div key={clip.id} className={styles.clipCard}>
            <div className={styles.clipHeader}>
              <span className={styles.clipNum}>Clip {clip.id}</span>
              <div className={styles.scoreChip}>
                <span className={styles.scoreLabel}>Hook</span>
                <span className={styles.scoreValue}>{Math.round(clip.hookScore * 100)}</span>
              </div>
            </div>

            <div
              className={styles.videoWrap}
              style={{
                aspectRatio: isPortrait ? "9/16" : isSquare ? "1/1" : "16/9",
              }}
            >
              <video
                className={styles.video}
                src={clip.signedUrl}
                controls
                playsInline
                preload="metadata"
              />
            </div>

            <div className={styles.clipMeta}>
              <div className={styles.scoreBarTrack}>
                <div
                  className={styles.scoreBarFill}
                  style={{ width: `${clip.hookScore * 100}%` }}
                />
              </div>
              <p className={styles.rationale}>{clip.rationale}</p>
              <p className={styles.timestamp}>
                {formatTime(clip.startTime)} — {formatTime(clip.endTime)}
              </p>
            </div>

            <button
              className={styles.downloadBtn}
              onClick={() => downloadClip(clip, index)}
              disabled={downloading === index || downloadingAll}
            >
              {downloading === index ? "Downloading..." : "Download clip"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
