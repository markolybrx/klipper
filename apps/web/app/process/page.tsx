"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./process.module.css";

type Layout = "9:16" | "16:9" | "1:1";
type Duration = 15 | 30 | 60 | 90;

const LAYOUTS: { value: Layout; label: string; hint: string }[] = [
  { value: "9:16", label: "Portrait", hint: "TikTok, Reels, Shorts" },
  { value: "16:9", label: "Landscape", hint: "YouTube, Twitter" },
  { value: "1:1", label: "Square", hint: "Instagram, Facebook" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: 15, label: "15s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
  { value: 90, label: "90s" },
];

export default function ProcessPage() {
  const router = useRouter();

  const [sourceReady, setSourceReady] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<Duration>(30);
  const [layout, setLayout] = useState<Layout>("9:16");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = sessionStorage.getItem("klipper_session");
    const sourceType = sessionStorage.getItem("klipper_source_type");
    const sourceUrl = sessionStorage.getItem("klipper_source_url");
    const storagePath = sessionStorage.getItem("klipper_storage_path");

    if (!sessionId || !sourceType) {
      router.replace("/");
      return;
    }

    if (sourceType === "url" && sourceUrl) {
      try {
        const u = new URL(sourceUrl);
        setSourceLabel(u.hostname + u.pathname.slice(0, 30));
      } catch {
        setSourceLabel(sourceUrl.slice(0, 50));
      }
    } else if (sourceType === "file" && storagePath) {
      const parts = storagePath.split("/");
      setSourceLabel(parts[parts.length - 1]);
    } else {
      router.replace("/");
      return;
    }

    setSourceReady(true);
  }, [router]);

  async function handleGenerate() {
    setError(null);
    setLoading(true);

    const sessionId = sessionStorage.getItem("klipper_session");
    const sourceType = sessionStorage.getItem("klipper_source_type");
    const sourceUrl = sessionStorage.getItem("klipper_source_url");
    const storagePath = sessionStorage.getItem("klipper_storage_path");

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        sourceType,
        sourceUrl: sourceUrl ?? null,
        storagePath: storagePath ?? null,
        prompt: prompt.trim() || null,
        duration,
        layout,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Analysis failed. Try again.");
      setLoading(false);
      return;
    }

    sessionStorage.setItem("klipper_clips", JSON.stringify(data.clips));
    sessionStorage.setItem("klipper_layout", layout);
    router.push("/results");
  }

  if (!sourceReady) {
    return (
      <main className={styles.main}>
        <div className={styles.checking}>Checking session...</div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Klipper</span>
        <button
          className={styles.startOver}
          onClick={() => {
            sessionStorage.clear();
            router.push("/");
          }}
        >
          Start over
        </button>
      </header>

      <div className={styles.sourceBar}>
        <div className={styles.sourceIndicator}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="#16a34a" strokeWidth="1.5"/>
            <path d="M4.5 7l2 2 3-3" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className={styles.sourceText}>Source ready</span>
        </div>
        <span className={styles.sourceLabel}>{sourceLabel}</span>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNum}>01</span>
          <div>
            <h2 className={styles.sectionTitle}>What should Klipper look for?</h2>
            <p className={styles.sectionHint}>
              Optional. Leave blank and the AI will find the most engaging moments on its own.
            </p>
          </div>
        </div>
        <textarea
          className={styles.promptInput}
          placeholder='e.g. "Find the funniest moments" or "Highlight the key takeaways" or "Clips that would work as a hook"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={400}
          disabled={loading}
        />
        <div className={styles.charCount}>{prompt.length} / 400</div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNum}>02</span>
          <div>
            <h2 className={styles.sectionTitle}>Clip duration</h2>
            <p className={styles.sectionHint}>Each clip will be trimmed to this length.</p>
          </div>
        </div>
        <div className={styles.optionGrid}>
          {DURATIONS.map((d) => (
            <button
              key={d.value}
              className={`${styles.optionBtn} ${duration === d.value ? styles.optionBtnActive : ""}`}
              onClick={() => setDuration(d.value)}
              disabled={loading}
            >
              {d.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionNum}>03</span>
          <div>
            <h2 className={styles.sectionTitle}>Layout</h2>
            <p className={styles.sectionHint}>Choose the aspect ratio for your clips.</p>
          </div>
        </div>
        <div className={styles.layoutGrid}>
          {LAYOUTS.map((l) => (
            <button
              key={l.value}
              className={`${styles.layoutBtn} ${layout === l.value ? styles.layoutBtnActive : ""}`}
              onClick={() => setLayout(l.value)}
              disabled={loading}
            >
              <div className={styles.layoutPreview}>
                <div
                  className={styles.layoutRect}
                  style={{
                    aspectRatio: l.value === "9:16" ? "9/16" : l.value === "16:9" ? "16/9" : "1/1",
                    width: l.value === "16:9" ? "100%" : l.value === "1:1" ? "56px" : "32px",
                    maxWidth: "100%",
                    border: `1.5px solid ${layout === l.value ? "#e8500a" : "#d1d5db"}`,
                    backgroundColor: layout === l.value ? "#fff8f5" : "#f9fafb",
                    transition: "all 0.15s",
                  }}
                />
              </div>
              <span className={styles.layoutLabel}>{l.label}</span>
              <span className={styles.layoutHint}>{l.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className={styles.error}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0, marginTop:"1px"}}>
            <circle cx="7" cy="7" r="6" stroke="#dc2626" strokeWidth="1.5"/>
            <path d="M7 4v4M7 10v.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {error}
        </div>
      )}

      <button
        className={styles.generateBtn}
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? (
          <span className={styles.loadingRow}>
            <svg className={styles.spinner} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
            </svg>
            Analyzing video — this may take a minute...
          </span>
        ) : (
          "Generate clips"
        )}
      </button>
    </main>
  );
}
