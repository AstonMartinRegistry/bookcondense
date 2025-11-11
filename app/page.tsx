/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PageMeta = {
  pageNumber: number;
  wordCount: number;
  preview: string;
};

type UiState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "processing"; message: string }
  | { status: "success"; url: string; filename: string }
  | { status: "error"; message: string };

const DEFAULT_SUMMARY = 70;
const DEFAULT_QUOTES = 30;

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [summaryDensity, setSummaryDensity] = useState(DEFAULT_SUMMARY);
  const [quoteDensity, setQuoteDensity] = useState(DEFAULT_QUOTES);
  const [uiState, setUiState] = useState<UiState>({ status: "idle" });
  const [progress, setProgress] = useState<{ processed: number; total: number }>(
    { processed: 0, total: 0 },
  );
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [metadataStatus, setMetadataStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [pagesMeta, setPagesMeta] = useState<PageMeta[] | null>(null);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [rangeStart, setRangeStart] = useState<number | "">("");
  const [rangeEnd, setRangeEnd] = useState<number | "">("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const downloadLinkRef = useRef<HTMLAnchorElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (uiState.status === "success" && download && downloadLinkRef.current) {
      downloadLinkRef.current.click();
    }
  }, [uiState, download]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!download) return;
    return () => {
      URL.revokeObjectURL(download.url);
    };
  }, [download]);

  const fetchPageMetadata = useCallback(async (pdf: File) => {
    setMetadataStatus("loading");
    setMetadataError(null);
    setPagesMeta(null);
    setSelectedPages([]);
    setRangeStart("");
    setRangeEnd("");
    setRangeError(null);

    const formData = new FormData();
    formData.append("file", pdf);

    try {
      const response = await fetch("/api/pdf-metadata", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error =
          (await response.json().catch(() => null)) ?? {
            error: "Failed to inspect PDF.",
          };
        throw new Error(error.error ?? "Failed to inspect PDF.");
      }

      const data = (await response.json()) as {
        pages: PageMeta[];
      };

      if (!data.pages || data.pages.length === 0) {
        throw new Error(
          "No readable pages were detected. Please upload a text-based PDF.",
        );
      }

      setPagesMeta(data.pages);
      setSelectedPages(data.pages.map((page) => page.pageNumber));
      setMetadataStatus("ready");
      setRangeStart(data.pages[0].pageNumber);
      setRangeEnd(data.pages[data.pages.length - 1].pageNumber);
      setRangeError(null);
    } catch (error) {
      setMetadataStatus("error");
      setMetadataError((error as Error).message);
    }
  }, []);

  const handlePageToggle = useCallback((pageNumber: number) => {
    setSelectedPages((current) => {
      if (current.includes(pageNumber)) {
        return current.filter((value) => value !== pageNumber);
      }
      return [...current, pageNumber].sort((a, b) => a - b);
    });
  }, []);

  const handleSelectAllPages = useCallback(() => {
    if (!pagesMeta) return;
    const allPages = pagesMeta.map((page) => page.pageNumber);
    setSelectedPages(allPages);
    if (pagesMeta.length > 0) {
      setRangeStart(pagesMeta[0].pageNumber);
      setRangeEnd(pagesMeta[pagesMeta.length - 1].pageNumber);
    }
    setRangeError(null);
  }, [pagesMeta]);

  const handleClearPages = useCallback(() => {
    setSelectedPages([]);
    setRangeError(null);
  }, []);

  const handleApplyRange = useCallback(() => {
    if (!pagesMeta) return;

    if (rangeStart === "" || rangeEnd === "") {
      setRangeError("Enter both start and end pages.");
      return;
    }

    const start = Number(rangeStart);
    const end = Number(rangeEnd);

    const firstPage = pagesMeta[0].pageNumber;
    const lastPage = pagesMeta[pagesMeta.length - 1].pageNumber;

    if (Number.isNaN(start) || Number.isNaN(end)) {
      setRangeError("Page range must be numeric.");
      return;
    }

    if (start > end) {
      setRangeError("Start page must be less than or equal to end page.");
      return;
    }

    if (start < firstPage || end > lastPage) {
      setRangeError(
        `Pages must be between ${firstPage} and ${lastPage}.`,
      );
      return;
    }

    const selection = pagesMeta
      .map((page) => page.pageNumber)
      .filter((pageNumber) => pageNumber >= start && pageNumber <= end);

    if (selection.length === 0) {
      setRangeError("No pages fall within that range.");
      return;
    }

    setSelectedPages(selection);
    setRangeError(null);
  }, [pagesMeta, rangeEnd, rangeStart]);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setUiState({ status: "idle" });
    setFile(null);
    setProgress({ processed: 0, total: 0 });
    setDownload((current) => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
    setIsDragActive(false);
    setMetadataStatus("idle");
    setMetadataError(null);
    setPagesMeta(null);
    setSelectedPages([]);
  }, []);

  const handleDrop = useCallback(
    (droppedFiles: FileList | null | undefined) => {
      if (!droppedFiles || droppedFiles.length === 0) return;
      const nextFile = droppedFiles[0];
      if (nextFile.type !== "application/pdf") {
        setUiState({
          status: "error",
          message: "Only PDF files are supported.",
        });
        return;
      }

      setFile(nextFile);
      setUiState({ status: "idle" });
      fetchPageMetadata(nextFile);
    },
    [fetchPageMetadata],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!file) {
        setUiState({
          status: "error",
          message: "Please select a PDF to condense.",
        });
        return;
      }

      if (metadataStatus !== "ready" || !pagesMeta) {
        setUiState({
          status: "error",
          message: "Please wait for the PDF pages to finish analyzing.",
        });
        return;
      }

      if (selectedPages.length === 0) {
        setUiState({
          status: "error",
          message: "Select at least one page to condense.",
        });
        return;
      }

      try {
        setUiState({ status: "processing", message: "Preparing pages…" });
        setProgress({ processed: 0, total: 0 });
        setDownload((current) => {
          if (current) {
            URL.revokeObjectURL(current.url);
          }
  return null;
        });

        const formData = new FormData();
        formData.append("file", file);
        formData.append("summaryDensity", String(summaryDensity));
        formData.append("quoteDensity", String(quoteDensity));
        formData.append("selectedPages", JSON.stringify(selectedPages));

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const response = await fetch("/api/condense", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        const contentType = response.headers.get("Content-Type") ?? "";

        if (!response.ok) {
          if (contentType.includes("application/json")) {
            const error =
              (await response.json().catch(() => null)) ?? {
                error: "Unknown error",
              };
            throw new Error(error.error ?? "Failed to condense PDF.");
          }
          throw new Error("Failed to condense PDF.");
        }

        if (!contentType.includes("text/event-stream")) {
          throw new Error("Unexpected response format from server.");
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Unable to read streaming response.");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (eventName: string, data: string) => {
          if (eventName === "meta") {
            const payload = JSON.parse(data) as { totalPages: number };
            setProgress({ processed: 0, total: payload.totalPages });
            setUiState({
              status: "processing",
              message: `Processing 0/${payload.totalPages} pages`,
            });
            return;
          }

          if (eventName === "progress") {
            const payload = JSON.parse(data) as {
              processedPages: number;
              totalPages: number;
            };
            setProgress({
              processed: payload.processedPages,
              total: payload.totalPages,
            });
            setUiState({
              status: "processing",
              message: `Processing ${payload.processedPages}/${payload.totalPages} pages`,
            });
            return;
          }

          if (eventName === "result") {
            const payload = JSON.parse(data) as {
              filename: string;
              base64Pdf: string;
            };
            const binary = atob(payload.base64Pdf);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            setDownload({ url, filename: payload.filename });
            setUiState({
              status: "success",
              url,
              filename: payload.filename,
            });
            return;
          }

          if (eventName === "error") {
            const payload = JSON.parse(data) as { message: string };
            throw new Error(payload.message);
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let separatorIndex: number;
          while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, separatorIndex).trim();
            buffer = buffer.slice(separatorIndex + 2);
            if (!rawEvent) continue;

            const lines = rawEvent.split("\n");
            let eventName = "message";
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice("event:".length).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice("data:".length).trim());
              }
            }

            const data = dataLines.join("\n");
            if (data) {
              handleEvent(eventName, data);
            }
          }
        }

        abortControllerRef.current = null;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        setUiState({
          status: "error",
          message: (error as Error).message,
        });
        abortControllerRef.current = null;
        setProgress({ processed: 0, total: 0 });
      }
    },
    [file, metadataStatus, pagesMeta, quoteDensity, selectedPages, summaryDensity],
  );

  return (
    <main style={styles.main}>
      <section style={styles.card}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>Book Condenser</h1>
            <p style={styles.subtitle}>
              Upload a PDF, tune the density sliders, and we’ll spin up a
              condensed edition with woven quotations.
            </p>
          </div>
        </header>

        <form style={styles.form} onSubmit={handleSubmit}>
          <div
            style={{
              ...styles.dropzone,
              borderColor: isDragActive
                ? "rgba(44,44,44,0.6)"
                : "rgba(44,44,44,0.35)",
              background: isDragActive ? "#f2eadf" : "#f9f3e9",
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!isDragActive) setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragActive(false);
              handleDrop(event.dataTransfer?.files);
            }}
          >
            <label style={styles.ctaButton}>
              <span style={styles.labelText}>
                {file ? file.name : "Select your PDF"}
              </span>
              <input
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(event) => {
                  handleDrop(event.target.files ?? null);
                }}
              />
            </label>
            <p style={styles.helperText}>
              Drop a PDF here or click to browse · Max 40MB
            </p>
          </div>

          {metadataStatus === "loading" && (
            <div style={styles.metadataNotice}>
              <p style={styles.statusText}>Analyzing pages…</p>
            </div>
          )}

          {metadataStatus === "error" && metadataError && (
            <p style={{ ...styles.statusText, color: "#d9534f" }}>
              {metadataError}
            </p>
          )}

          {metadataStatus === "ready" && pagesMeta && (
            <div style={styles.pagePicker}>
              <div style={styles.pagePickerHeader}>
                <span style={styles.pagePickerTitle}>Select pages to condense</span>
                <div style={styles.pagePickerActions}>
                  <button
                    type="button"
                    style={styles.pagePickerButton}
                    onClick={handleSelectAllPages}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    style={styles.pagePickerButton}
                    onClick={handleClearPages}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div style={styles.rangeControls}>
                <label style={styles.rangeInputGroup}>
                  <span style={styles.rangeLabel}>From</span>
                  <input
                    type="number"
                    min={pagesMeta[0]?.pageNumber ?? 1}
                    max={pagesMeta[pagesMeta.length - 1]?.pageNumber ?? undefined}
                    value={rangeStart === "" ? "" : rangeStart}
                    onChange={(event) => {
                      const value = event.target.value;
                      setRangeStart(value === "" ? "" : Number(value));
                    }}
                    style={styles.rangeInput}
                  />
                </label>
                <label style={styles.rangeInputGroup}>
                  <span style={styles.rangeLabel}>To</span>
                  <input
                    type="number"
                    min={pagesMeta[0]?.pageNumber ?? 1}
                    max={pagesMeta[pagesMeta.length - 1]?.pageNumber ?? undefined}
                    value={rangeEnd === "" ? "" : rangeEnd}
                    onChange={(event) => {
                      const value = event.target.value;
                      setRangeEnd(value === "" ? "" : Number(value));
                    }}
                    style={styles.rangeInput}
                  />
                </label>
                <button
                  type="button"
                  style={styles.rangeApplyButton}
                  onClick={handleApplyRange}
                >
                  Apply range
                </button>
              </div>
              {rangeError && (
                <p style={styles.rangeError}>{rangeError}</p>
              )}
              <div style={styles.pageList}>
                {pagesMeta.map((page) => {
                  const checked = selectedPages.includes(page.pageNumber);
                  return (
                    <label key={page.pageNumber} style={styles.pageItem}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handlePageToggle(page.pageNumber)}
                        style={styles.pageCheckbox}
                      />
                      <div style={styles.pageContent}>
                        <div style={styles.pageMeta}>
                          <span style={styles.pageMetaLabel}>
                            Page {page.pageNumber}
                          </span>
                          <span style={styles.pageMetaInfo}>
                            {page.wordCount} words
                          </span>
                        </div>
                        <p style={styles.pagePreview}>{page.preview}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div style={styles.controlsRow}>
            <div style={styles.sliderGroup}>
              <label style={styles.sliderLabel}>
                Summary density ({summaryDensity}%)
              </label>
              <input
                type="range"
                min={30}
                max={100}
                step={5}
                value={summaryDensity}
                onChange={(event) =>
                  setSummaryDensity(Number(event.target.value))
                }
                style={{ accentColor: "#1b1b1b" }}
              />
            </div>
            <div style={styles.sliderGroup}>
              <label style={styles.sliderLabel}>
                Quote density ({quoteDensity}%)
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={quoteDensity}
                onChange={(event) =>
                  setQuoteDensity(Number(event.target.value))
                }
                style={{ accentColor: "#1b1b1b" }}
              />
            </div>
          </div>

          <div style={styles.actions}>
            <button
              type="submit"
              style={styles.ctaButton}
              disabled={
                uiState.status === "processing" ||
                metadataStatus !== "ready" ||
                selectedPages.length === 0
              }
            >
              {uiState.status === "processing" ? "Condensing…" : "Condense PDF"}
            </button>
            <button
              type="button"
              style={styles.ctaOutlineButton}
              onClick={reset}
              disabled={uiState.status === "processing"}
            >
              Reset
            </button>
          </div>
        </form>

        {uiState.status === "processing" && progress.total > 0 && (
          <div style={styles.progressWrapper}>
            <div style={styles.progressHeader}>
              <span style={styles.statusText}>
                {uiState.message}
              </span>
              <span style={styles.statusText}>
                {progress.processed}/{progress.total}
              </span>
            </div>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${Math.min(
                    100,
                    (progress.processed / progress.total) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        <div style={styles.footer}>
          {uiState.status === "error" && (
            <p style={{ ...styles.statusText, color: "#d9534f" }}>
              {uiState.message}
            </p>
          )}
          {uiState.status === "success" && download && (
            <div style={styles.successRow}>
              <p style={styles.statusText}>Condensed PDF ready.</p>
              <a
                ref={downloadLinkRef}
                href={download.url}
                download={download.filename}
                style={styles.downloadLink}
              >
                Download
              </a>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "#f5f0e8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 1.25rem",
    fontFamily: "'Times New Roman', 'Iowan Old Style', serif",
    color: "#2c2c2c",
  },
  card: {
    width: "100%",
    maxWidth: "760px",
    background: "#fbf8f2",
    borderRadius: "12px",
    padding: "1.8rem",
    border: "1px solid rgba(44,44,44,0.18)",
    boxShadow: "10px 10px 0 rgba(44,44,44,0.08)",
    display: "flex",
    flexDirection: "column",
    gap: "1.6rem",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  title: {
    margin: 0,
    fontSize: "2.15rem",
    fontWeight: 400,
    letterSpacing: "-0.02em",
    textTransform: "uppercase",
  },
  subtitle: {
    margin: 0,
    fontSize: "0.82rem",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    lineHeight: 1.8,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "2rem",
  },
  dropzone: {
    border: "1px dashed rgba(44,44,44,0.35)",
    borderRadius: "12px",
    padding: "1.75rem",
    textAlign: "center",
    background: "#f9f3e9",
  },
  ctaButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.9rem 2.2rem",
    borderRadius: "999px",
    background: "#1b1b1b",
    color: "#f6f2e9",
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: "0.78rem",
    cursor: "pointer",
    border: "1px solid #1b1b1b",
    fontFamily: "'Times New Roman', 'Iowan Old Style', serif",
  },
  ctaOutlineButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.9rem 2.2rem",
    borderRadius: "999px",
    background: "transparent",
    color: "#1b1b1b",
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: "0.78rem",
    cursor: "pointer",
    border: "1px solid rgba(44,44,44,0.35)",
    fontFamily: "'Times New Roman', 'Iowan Old Style', serif",
  },
  labelText: {
    fontSize: "0.78rem",
  },
  helperText: {
    margin: "1.1rem 0 0",
    color: "rgba(44,44,44,0.6)",
    fontSize: "0.85rem",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  metadataNotice: {
    border: "1px solid rgba(44,44,44,0.2)",
    borderRadius: "10px",
    padding: "1rem 1.25rem",
    background: "#fbf8f2",
  },
  controlsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "1.25rem",
  },
  sliderGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    background: "#fbf8f2",
    borderRadius: "10px",
    padding: "1.1rem 1.25rem",
    border: "1px solid rgba(44,44,44,0.2)",
  },
  sliderLabel: {
    fontWeight: 500,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    fontSize: "0.82rem",
  },
  pagePicker: {
    border: "1px solid rgba(44,44,44,0.2)",
    borderRadius: "12px",
    padding: "1.25rem 1.4rem",
    background: "#fbf8f2",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  pagePickerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    flexWrap: "wrap",
  },
  pagePickerTitle: {
    fontSize: "0.78rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
  },
  pagePickerActions: {
    display: "flex",
    gap: "0.6rem",
  },
  pagePickerButton: {
    border: "1px solid rgba(44,44,44,0.35)",
    borderRadius: "999px",
    padding: "0.45rem 1.2rem",
    background: "transparent",
    color: "#1b1b1b",
    fontSize: "0.7rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
  },
  rangeControls: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, auto))",
    gap: "0.75rem",
    alignItems: "end",
  },
  rangeInputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  rangeLabel: {
    fontSize: "0.7rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  rangeInput: {
    borderRadius: "12px",
    border: "1px solid rgba(44,44,44,0.35)",
    padding: "0.55rem 0.75rem",
    fontSize: "0.85rem",
    background: "#fff",
  },
  rangeApplyButton: {
    border: "1px solid #1b1b1b",
    borderRadius: "999px",
    padding: "0.55rem 1.6rem",
    background: "#1b1b1b",
    color: "#f6f2e9",
    fontSize: "0.75rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "'Times New Roman', 'Iowan Old Style', serif",
  },
  rangeError: {
    margin: 0,
    color: "#d9534f",
    fontSize: "0.7rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  pageList: {
    display: "grid",
    gap: "0.75rem",
    maxHeight: "240px",
    overflowY: "auto",
    paddingRight: "0.4rem",
  },
  pageItem: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "0.9rem",
    padding: "0.6rem 0.4rem",
    borderBottom: "1px solid rgba(44,44,44,0.12)",
  },
  pageCheckbox: {
    width: "1rem",
    height: "1rem",
    marginTop: "0.3rem",
    accentColor: "#1b1b1b",
    cursor: "pointer",
  },
  pageContent: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  pageMeta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.75rem",
    fontSize: "0.72rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  pageMetaLabel: {
    fontWeight: 600,
  },
  pageMetaInfo: {
    color: "rgba(44,44,44,0.6)",
  },
  pagePreview: {
    margin: 0,
    fontSize: "0.8rem",
    lineHeight: 1.5,
    color: "rgba(44,44,44,0.85)",
  },
  actions: {
    display: "flex",
    gap: "1rem",
    flexWrap: "wrap",
  },
  primaryButton: {
    border: "none",
    borderRadius: "999px",
    padding: "0.9rem 2.8rem",
    fontWeight: 500,
    fontSize: "0.85rem",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#fbf8f2",
    background: "#2c2c2c",
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid rgba(44,44,44,0.35)",
    borderRadius: "999px",
    padding: "0.9rem 2.4rem",
    fontWeight: 500,
    fontSize: "0.85rem",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#2c2c2c",
    background: "transparent",
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1.5rem",
    minHeight: "32px",
  },
  statusText: {
    margin: 0,
    color: "#2c2c2c",
    fontSize: "0.88rem",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  progressWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    marginTop: "-0.5rem",
  },
  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTrack: {
    width: "100%",
    height: "6px",
    borderRadius: "999px",
    background: "rgba(44,44,44,0.15)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: "999px",
    background: "#2c2c2c",
    transition: "width 0.3s ease",
  },
  successRow: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  downloadLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    padding: "0.6rem 1.4rem",
    background: "#0ea5e9",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 600,
  },
};


