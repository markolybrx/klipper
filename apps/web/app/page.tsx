"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";
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
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (selected.size > 500 * 1024 * 1024) {
      setError("File exceeds the 500MB limit.");
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
      if (!url.trim()) { setError("Paste a video URL to continue."); return; }
      try { new URL(url.trim()); } catch { setError("That doesn't look like a valid URL."); return; }
    }

    if (mode === "file" && !file) { setError("Select a video file to continue."); return; }

    setLoading(true);
    const sessionId = crypto.randomUUID();

    if (mode === "url") {
      sessionStorage.setItem("klipper_session", sessionId);
      sessionStorage.setItem("klipper_source_type", "url");
      sessionStorage.setItem("klipper_source_url", url.trim());
      router.push("/process");
      return;
    }

    setUploadProgress("Uploading...");
    const supabase = getBrowserClient();
    const ext = file!.name.split(".").pop() ?? "mp4";
    const storagePath = `${sessionId}/source.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("source-videos")
      .upload(storagePath, file!, { contentType: file!.type, upsert: false });

    if (uploadError) {
      setError("Upload failed: " + uploadError.message);
      setLoading(false);
      setUploadProgress(null);
      return;
    }

    sessionStorage.setItem("klipper_session", sessionId);
    sessionStorage.setItem("klipper_source_type", "file");
    sessionStorage.setItem("klipper_storage_path", storagePath);
    router.push("/process");
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Klipper</span>
        <nav className={styles.nav}>
          <span className={styles.navItem}>No account needed</span>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.badge}>AI-powered</div>
        <h1 className={styles.heroTitle}>
          Turn any video into<br />5 ready-to-post clips.
        </h1>
        <p className={styles.heroSubtitle}>
          Paste a public URL or upload a file. Klippie finds your best moments,
          cuts them for TikTok, Reels, or Shorts, and hands them back in seconds.
          No account. No watermark.
        </p>
      </section>

      <section className={styles.inputCard}>
        <div className={styles.modeTabs}>
          <button
            className={`${styles.modeTab} ${mode === "url" ? styles.modeTabActive : ""}`}
            onClick={() => { setMode("url"); setError(null); setFile(null); }}
          >
            Paste a URL
          </button>
          <button
            className={`${styles.modeTab} ${mode === "file" ? styles.modeTabActive : ""}`}
            onClick={() => { setMode("file"); setError(null); setUrl(""); }}
          >
            Upload a file
          </button>
        </div>

        {mode === "url" && (
          <div className={styles.urlRow}>
            <input
              type="url"
              className={styles.urlInput}
              placeholder="TikTok, Instagram, Facebook, Twitter or any direct video URL (YouTube: upload file instead)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
              disabled={loading}
              autoFocus
            />
          </div>
        )}

        {mode === "file" && (
          <div
            className={styles.dropZone}
            onClick={() => !loading && fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (loading) return;
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) {
                handleFileChange({ target: { files: e.dataTransfer.files } } as unknown as React.ChangeEvent<HTMLInputElement>);
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
                <div className={styles.fileIcon}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M4 4h8l4 4v8H4V4z" stroke="#e8500a" strokeWidth="1.5" fill="none"/>
                    <path d="M12 4v4h4" stroke="#e8500a" strokeWidth="1.5"/>
                  </svg>
                </div>
                <div className={styles.fileInfo}>
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileSize}>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
                {!loading && (
                  <button className={styles.fileRemove} onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.dropPrompt}>
                <div className={styles.dropIconWrap}>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <path d="M14 4v14M8 12l6-8 6 8" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M4 22h20" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <span className={styles.dropText}>Drag a video here or click to browse</span>
                <span className={styles.dropHint}>MP4, MOV, WEBM, AVI — max 500MB</span>
              </div>
            )}
          </div>
        )}

        {uploadProgress && (
          <div className={styles.uploadProgress}>{uploadProgress}</div>
        )}

        {error && (
          <div className={styles.error}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0,marginTop:"1px"}}>
              <circle cx="7" cy="7" r="6" stroke="#dc2626" strokeWidth="1.5"/>
              <path d="M7 4v4M7 10v.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        <button className={styles.continueBtn} onClick={handleContinue} disabled={loading}>
          {loading ? (
            <span className={styles.loadingRow}>
              <svg className={styles.spinner} width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
              </svg>
              {uploadProgress ?? "Working..."}
            </span>
          ) : "Continue"}
        </button>

        <p className={styles.inputNote}>
          Sessions are temporary — close the tab and everything is cleared.
        </p>
      </section>

      <section className={styles.features}>
        <div className={styles.feature}>
          <div className={styles.featureNum}>01</div>
          <h3 className={styles.featureTitle}>Klippie finds your hooks</h3>
          <p className={styles.featureDesc}>
            Our AI reads the transcript and pacing to surface your most
            watchable moments — ranked by hook score.
          </p>
        </div>
        <div className={styles.feature}>
          <div className={styles.featureNum}>02</div>
          <h3 className={styles.featureTitle}>You pick the format</h3>
          <p className={styles.featureDesc}>
            Choose your clip duration and layout — portrait for TikTok and
            Reels, landscape for YouTube, square for everything else.
          </p>
        </div>
        <div className={styles.feature}>
          <div className={styles.featureNum}>03</div>
          <h3 className={styles.featureTitle}>Download and post</h3>
          <p className={styles.featureDesc}>
            Get up to 5 clips back, preview each one, and download
            individually or as a zip. Ready to upload anywhere.
          </p>
        </div>
      </section>
    </main>
  );
}
