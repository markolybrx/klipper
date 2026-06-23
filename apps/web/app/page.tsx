"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type InputMode = "url" | "file";

export default function LandingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<InputMode>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (selected.size > 200 * 1024 * 1024) {
      setError("File exceeds the 200MB limit.");
      return;
    }
    const allowed = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"];
    if (!allowed.includes(selected.type)) {
      setError("Unsupported format. Use MP4, MOV, WEBM, or AVI.");
      return;
    }
    setError(null);
    setFile(selected);
  }

  async function handleContinue() {
    setError(null);

    if (mode === "url") {
      if (!url.trim()) {
        setError("Paste a video URL to continue.");
        return;
      }
      try {
        new URL(url.trim());
      } catch {
        setError("That doesn't look like a valid URL.");
        return;
      }
    }

    if (mode === "file" && !file) {
      setError("Select a video file to continue.");
      return;
    }

    setLoading(true);

    // Generate session ID in browser — all temp storage keyed to this
    const sessionId = crypto.randomUUID();

    if (mode === "url") {
      sessionStorage.setItem("klipper_session", sessionId);
      sessionStorage.setItem("klipper_source_type", "url");
      sessionStorage.setItem("klipper_source_url", url.trim());
      router.push("/process");
      return;
    }

    // File upload — POST to /api/ingest
    const formData = new FormData();
    formData.append("file", file!);
    formData.append("sessionId", sessionId);

    const res = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Upload failed. Try again.");
      setLoading(false);
      return;
    }

    sessionStorage.setItem("klipper_session", sessionId);
    sessionStorage.setItem("klipper_source_type", "file");
    sessionStorage.setItem("klipper_storage_path", data.storagePath);
    router.push("/process");
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <span className={styles.wordmark}>KLIPPER</span>
        <span className={styles.tagline}>AI video clipper — no account needed</span>
      </header>

      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Drop a video.<br />Get 5 clips.
        </h1>
        <p className={styles.heroSubtitle}>
          Paste any public video URL or upload a file. Klipper's AI analyzes the
          content and generates up to 5 highlight clips — formatted for TikTok,
          Reels, Shorts, or landscape. No account. No watermark. No friction.
        </p>
      </section>

      <section className={styles.inputCard}>
        <div className={styles.modeTabs}>
          <button
            className={`${styles.modeTab} ${mode === "url" ? styles.modeTabActive : ""}`}
            onClick={() => { setMode("url"); setError(null); }}
          >
            Paste URL
          </button>
          <button
            className={`${styles.modeTab} ${mode === "file" ? styles.modeTabActive : ""}`}
            onClick={() => { setMode("file"); setError(null); }}
          >
            Upload File
          </button>
        </div>

        {mode === "url" && (
          <div className={styles.urlRow}>
            <input
              type="url"
              className={styles.urlInput}
              placeholder="https://youtube.com/watch?v=... or any public video URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
              disabled={loading}
            />
          </div>
        )}

        {mode === "file" && (
          <div
            className={styles.dropZone}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) {
                const syntheticEvent = {
                  target: { files: e.dataTransfer.files },
                } as unknown as React.ChangeEvent<HTMLInputElement>;
                handleFileChange(syntheticEvent);
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
              className={styles.fileInputHidden}
              onChange={handleFileChange}
              disabled={loading}
            />
            {file ? (
              <div className={styles.fileSelected}>
                <span className={styles.fileIcon}>[v]</span>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
            ) : (
              <div className={styles.dropPrompt}>
                <span className={styles.dropIcon}>[+]</span>
                <span className={styles.dropText}>
                  Drag a video here or tap to browse
                </span>
                <span className={styles.dropHint}>MP4, MOV, WEBM, AVI — max 200MB</span>
              </div>
            )}
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={styles.continueBtn}
          onClick={handleContinue}
          disabled={loading}
        >
          {loading ? "Uploading..." : "Continue ->"}
        </button>
      </section>

      <section className={styles.features}>
        <div className={styles.feature}>
          <span className={styles.featureGlyph}>[AI]</span>
          <p className={styles.featureText}>
            Gemini analyzes transcript and pacing to find your best moments
          </p>
        </div>
        <div className={styles.feature}>
          <span className={styles.featureGlyph}>[05]</span>
          <p className={styles.featureText}>
            Up to 5 clip options per video — ranked by hook score
          </p>
        </div>
        <div className={styles.feature}>
          <span className={styles.featureGlyph}>[DL]</span>
          <p className={styles.featureText}>
            Download individually or all at once — ready for any platform
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Sessions are temporary. Close the tab and the clips are gone.</span>
      </footer>
    </main>
  );
}
