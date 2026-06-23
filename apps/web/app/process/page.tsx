"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./process.module.css";

type Layout = "9:16" | "16:9" | "1:1";
type Duration = 15 | 30 | 60 | 300 | 600;

const LAYOUTS: { value: Layout; label: string; hint: string }[] = [
  { value: "9:16", label: "Portrait", hint: "TikTok, Reels, Shorts" },
  { value: "16:9", label: "Landscape", hint: "YouTube, Twitter" },
  { value: "1:1", label: "Square", hint: "Instagram, Facebook" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
];

const PROMPT_PRESETS = [
  "Find the most engaging, high-energy moments",
  "Extract the key insights and main points",
  "Find moments that work as a hook in the first 3 seconds",
];

const LONG_PORTRAIT_LAYOUTS: Layout[] = ["9:16"];
const LONG_DURATIONS: Duration[] = [300, 600];

interface ProgressState {
  percent: number;
  stage: string;
}

export default function ProcessPage() {
  const router = useRouter();

  const [sourceReady, setSourceReady] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<Duration>(30);
  const [layout, setLayout] = useState<Layout>("9:16");

  const [phase, setPhase] = useState<"options" | "generating" | "error">("options");
  const [progress, setProgress] = useState<ProgressState>({ percent: 0, stage: "" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const sessionId = sessionStorage.getItem("klipper_session");
    const sourceType = sessionStorage.getItem("klipper_source_type");
    const sourceUrl = sessionStorage.getItem("klipper_source_url");
    const storagePath = sessionStorage.getItem("klipper_storage_path");

    if (!sessionId || !sourceType) { router.replace("/"); return; }

    if (sourceType === "url" && sourceUrl) {
      try {
        const u = new URL(sourceUrl);
        setSourceLabel(u.hostname + u.pathname.slice(0, 40));
      } catch {
        setSourceLabel(sourceUrl.slice(0, 60));
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

  function applyPreset(preset: string) {
    setPrompt(preset);
  }

  const showPlatformWarning =
    LONG_DURATIONS.includes(duration) && LONG_PORTRAIT_LAYOUTS.includes(layout);

  async function handleGenerate() {
    setErrorMsg(null);
    setPhase("generating");
    setProgress({ percent: 0, stage: "Starting..." });

    const sessionId = sessionStorage.getItem("klipper_session");
    const sourceType = sessionStorage.getItem("klipper_source_type");
    const sourceUrl = sessionStorage.getItem("klipper_source_url");
    const storagePath = sessionStorage.getItem("klipper_storage_path");

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/generate", {
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
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Generation failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw);

            if (event.type === "progress") {
              setProgress({ percent: event.percent, stage: event.stage });
            }

            if (event.type === "complete") {
              setProgress({ percent: 100, stage: "Done" });
              sessionStorage.setItem("klipper_clips", JSON.stringify(event.clips));
              sessionStorage.setItem("klipper_layout", layout);
              router.push("/results");
              return;
            }

            if (event.type === "error") {
              throw new Error(event.message ?? "Generation failed.");
            }
          } catch (parseErr) {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function handleRetry() {
    setPhase("options");
    setProgress({ percent: 0, stage: "" });
    setErrorMsg(null);
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
          onClick={() => { sessionStorage.clear(); router.push("/"); }}
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

      {phase === "generating" && (
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span className={styles.progressStage}>{progress.stage}</span>
            <span className={styles.progressPct}>{progress.percent}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className={styles.progressNote}>
            Do not close this tab. This may take a minute depending on video length.
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className={styles.errorSection}>
          <div className={styles.errorIcon}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" stroke="#dc2626" strokeWidth="1.5"/>
              <path d="M10 6v5M10 14v.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className={styles.errorBody}>
            <p className={styles.errorTitle}>Generation failed</p>
            <p className={styles.errorMsg}>{errorMsg}</p>
          </div>
          <button className={styles.retryBtn} onClick={handleRetry}>
            Try again
          </button>
        </div>
      )}

      {phase === "options" && (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionNum}>01</span>
              <div>
                <h2 className={styles.sectionTitle}>What should Klipper look for?</h2>
                <p className={styles.sectionHint}>
                  Pick a starting point or write your own. Leave blank and the AI
                  finds the most engaging moments automatically.
                </p>
              </div>
            </div>
            <div className={styles.presets}>
              {PROMPT_PRESETS.map((p) => (
                <button
                  key={p}
                  className={`${styles.presetChip} ${prompt === p ? styles.presetChipActive : ""}`}
                  onClick={() => applyPreset(prompt === p ? "" : p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <textarea
              className={styles.promptInput}
              placeholder="Or write your own instruction..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={400}
            />
            <div className={styles.charCount}>{prompt.length} / 400</div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionNum}>02</span>
              <div>
                <h2 className={styles.sectionTitle}>Clip duration</h2>
                <p className={styles.sectionHint}>
                  Each of the 5 clips will be trimmed to this length.
                </p>
              </div>
            </div>
            <div className={styles.optionGrid}>
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  className={`${styles.optionBtn} ${duration === d.value ? styles.optionBtnActive : ""}`}
                  onClick={() => setDuration(d.value)}
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
                <p className={styles.sectionHint}>
                  Choose the aspect ratio for your clips.
                </p>
              </div>
            </div>
            <div className={styles.layoutGrid}>
              {LAYOUTS.map((l) => (
                <button
                  key={l.value}
                  className={`${styles.layoutBtn} ${layout === l.value ? styles.layoutBtnActive : ""}`}
                  onClick={() => setLayout(l.value)}
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
            {showPlatformWarning && (
              <div className={styles.platformWarning}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0, marginTop:"1px"}}>
                  <path d="M7 1L13 12H1L7 1z" stroke="#d97706" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M7 5v3M7 10v.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span>
                  TikTok supports up to 10 min, but Reels and Shorts cap at 90s and 60s.
                  This clip length may not be supported on all portrait platforms.
                </span>
              </div>
            )}
          </section>

          <button className={styles.generateBtn} onClick={handleGenerate}>
            Generate clips
          </button>
        </>
      )}
    </main>
  );
}
