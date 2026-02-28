import { useEffect, useLayoutEffect, useRef, useState } from "react";
import DotWaveBackground from "./components/DotWaveBackground";
import LiveKitTester from "./components/LiveKitTester";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import closeIcon from "../assets/icons/close.svg";

const TITLE_TEXT = "Welcome to the Matrix.";
const SCRAMBLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:'\",.<>?/`~";
const SCRAMBLE_DURATION_MS = 2000;
const SCRAMBLE_INTERVAL_MS = 40;
const SUBTITLE_REVEAL_DELAY_MS = 480;

const examplePrompts = [
  "Help me simulate the effect of a new bill I would like to introduce in the state of Illinois...",
  "Help me simulate the effect of decreased taxes in America...",
  "Help me simulate my freshman year of college friend group's eventual fallout...",
  "Help me simulate how asking out my crush would go...",
  "Help me simulate a seating arrangement for a wedding with 100 guests...",
];
const SHARED_PREFIX = "Help me simulate ";

const TYPING_SPEED_MS = 40;
const DELETING_SPEED_MS = 24;
const HOLD_AT_FULL_MS = 1500;
const HOLD_BETWEEN_PROMPTS_MS = 360;
const NOTICE_DURATION_MS = 2000;
const NOTICE_FADE_MS = 450;
const CHIP_REMOVE_ANIMATION_MS = 520;
const CHIP_REPOSITION_ANIMATION_MS = 620;
const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "log"
]);
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "doc",
  "docx",
  "rtf",
  "png",
  "jpg",
  "jpeg"
]);
const MAX_TOTAL_FILES = 200;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const PLANNER_CONTEXT_ENDPOINT = import.meta.env.VITE_PLANNER_CONTEXT_ENDPOINT || "/api/planner/context";

function extensionFor(name) {
  const split = name.split(".");
  if (split.length <= 1) return "";
  return split.at(-1).toLowerCase();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isAllowedContextFile(file) {
  if (file.type === "image/png" || file.type === "image/jpeg") return true;
  if (file.type && file.type.startsWith("text/")) return true;
  return ALLOWED_EXTENSIONS.has(extensionFor(file.name));
}

function filePathForContext(file) {
  return file.webkitRelativePath || file.name;
}

function fileLabel(file) {
  const ext = extensionFor(file.name);
  if (ext) return ext.toUpperCase();
  if (file.type && file.type.startsWith("text/")) return "TEXT";
  return "FILE";
}

function fileNameFromPath(path) {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return segments.at(-1) || path;
}

function App() {
  const [displayTitle, setDisplayTitle] = useState(TITLE_TEXT);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [scenarioText, setScenarioText] = useState("");
  const [contextFiles, setContextFiles] = useState([]);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewMode, setPreviewMode] = useState("none");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [showUploadNotice, setShowUploadNotice] = useState(false);
  const [submitNotice, setSubmitNotice] = useState({ kind: "idle", message: "" });
  const [showSubmitNotice, setShowSubmitNotice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [placeholderText, setPlaceholderText] = useState(
    examplePrompts[0].startsWith(SHARED_PREFIX) ? SHARED_PREFIX : ""
  );
  const [promptIndex, setPromptIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [removingContextIds, setRemovingContextIds] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const contextFilesRef = useRef(contextFiles);
  const removeTimersRef = useRef(new Map());
  const contextChipRefs = useRef(new Map());
  const previousChipPositionsRef = useRef(new Map());

  useEffect(() => {
    contextFilesRef.current = contextFiles;
  }, [contextFiles]);

  useLayoutEffect(() => {
    const chipNodes = contextChipRefs.current;
    const previousPositions = previousChipPositionsRef.current;
    const nextPositions = new Map();

    chipNodes.forEach((node, id) => {
      nextPositions.set(id, {
        left: node.offsetLeft,
        top: node.offsetTop
      });
    });

    chipNodes.forEach((node, id) => {
      if (node.classList.contains("removing")) return;

      const previousRect = previousPositions.get(id);
      const nextRect = nextPositions.get(id);
      if (!previousRect || !nextRect) return;

      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

      node.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" }
        ],
        {
          duration: CHIP_REPOSITION_ANIMATION_MS,
          easing: "cubic-bezier(0.26, 1.18, 0.4, 1)",
          fill: "none"
        }
      );
    });

    previousChipPositionsRef.current = nextPositions;
  }, [contextFiles]);

  useEffect(() => {
    return () => {
      removeTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      removeTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!uploadNotice) {
      setShowUploadNotice(false);
      return undefined;
    }

    setShowUploadNotice(true);
    const fadeTimer = window.setTimeout(() => {
      setShowUploadNotice(false);
    }, Math.max(0, NOTICE_DURATION_MS - NOTICE_FADE_MS));
    const clearTimer = window.setTimeout(() => {
      setUploadNotice("");
    }, NOTICE_DURATION_MS);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [uploadNotice]);

  useEffect(() => {
    if (submitNotice.kind === "idle" || !submitNotice.message) {
      setShowSubmitNotice(false);
      return undefined;
    }

    setShowSubmitNotice(true);
    const fadeTimer = window.setTimeout(() => {
      setShowSubmitNotice(false);
    }, Math.max(0, NOTICE_DURATION_MS - NOTICE_FADE_MS));
    const clearTimer = window.setTimeout(() => {
      setSubmitNotice({ kind: "idle", message: "" });
    }, NOTICE_DURATION_MS);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [submitNotice]);

  useEffect(() => {
    if (!previewTarget) {
      setPreviewMode("none");
      setPreviewUrl("");
      setPreviewText("");
      setPreviewError("");
      return undefined;
    }

    const file = previewTarget.file;
    const extension = extensionFor(file.name);
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || extension === "pdf";
    const isText = file.type.startsWith("text/") || TEXT_PREVIEW_EXTENSIONS.has(extension);

    let objectUrl = "";
    let cancelled = false;

    const loadPreview = async () => {
      setPreviewError("");
      setPreviewText("");

      if (isImage) {
        objectUrl = URL.createObjectURL(file);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPreviewUrl(objectUrl);
        setPreviewMode("image");
        return;
      }

      if (isPdf) {
        objectUrl = URL.createObjectURL(file);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPreviewUrl(objectUrl);
        setPreviewMode("pdf");
        return;
      }

      if (isText) {
        setPreviewMode("text-loading");
        try {
          const content = await file.text();
          if (cancelled) return;
          setPreviewText(content);
          setPreviewMode("text");
        } catch (error) {
          if (cancelled) return;
          setPreviewMode("unsupported");
          setPreviewError("Could not render a text preview for this file.");
        }
        return;
      }

      objectUrl = URL.createObjectURL(file);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setPreviewUrl(objectUrl);
      setPreviewMode("unsupported");
    };

    loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewTarget]);

  useEffect(() => {
    if (!previewTarget) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setPreviewTarget(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [previewTarget]);

  useEffect(() => {
    setShowSubtitle(false);
    const titleChars = TITLE_TEXT.split("");
    const shuffledIndices = titleChars.map((_, index) => index);
    for (let i = shuffledIndices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }
    const resolvedIndices = new Set();
    const totalTicks = Math.max(1, Math.round(SCRAMBLE_DURATION_MS / SCRAMBLE_INTERVAL_MS));
    let tick = 0;
    let subtitleDelayTimer;

    const randomChar = () =>
      SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];

    const buildScrambledTitle = () =>
      titleChars
        .map((char, index) => (resolvedIndices.has(index) ? char : randomChar()))
        .join("");

    setDisplayTitle(buildScrambledTitle());

    const timer = window.setInterval(() => {
      tick += 1;

      const targetResolvedCount = Math.min(
        titleChars.length,
        Math.floor((tick / totalTicks) * titleChars.length)
      );

      for (let i = resolvedIndices.size; i < targetResolvedCount; i += 1) {
        resolvedIndices.add(shuffledIndices[i]);
      }

      setDisplayTitle(buildScrambledTitle());

      if (tick >= totalTicks) {
        window.clearInterval(timer);
        setDisplayTitle(TITLE_TEXT);
        subtitleDelayTimer = window.setTimeout(() => {
          setShowSubtitle(true);
        }, SUBTITLE_REVEAL_DELAY_MS);
      }
    }, SCRAMBLE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      if (subtitleDelayTimer) {
        window.clearTimeout(subtitleDelayTimer);
      }
    };
  }, []);

  useEffect(() => {
    const currentPrompt = examplePrompts[promptIndex];
    const retainedPrefixLength = currentPrompt.startsWith(SHARED_PREFIX) ? SHARED_PREFIX.length : 0;
    let delay = isDeleting ? DELETING_SPEED_MS : TYPING_SPEED_MS;

    if (!isDeleting && placeholderText === currentPrompt) {
      delay = HOLD_AT_FULL_MS;
    } else if (isDeleting && placeholderText.length <= retainedPrefixLength) {
      delay = HOLD_BETWEEN_PROMPTS_MS;
    }

    const timer = window.setTimeout(() => {
      if (!isDeleting) {
        if (placeholderText === currentPrompt) {
          setIsDeleting(true);
          return;
        }

        setPlaceholderText(currentPrompt.slice(0, placeholderText.length + 1));
        return;
      }

      if (placeholderText.length <= retainedPrefixLength) {
        setIsDeleting(false);
        setPromptIndex((prev) => (prev + 1) % examplePrompts.length);
        return;
      }

      setPlaceholderText(currentPrompt.slice(0, placeholderText.length - 1));
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isDeleting, placeholderText, promptIndex]);

  const addContextFiles = (files) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    const previousFiles = contextFilesRef.current;
    const accepted = [];
    const rejected = [];
    let duplicateCount = 0;
    const existingKeys = new Set(
      previousFiles.map(({ file, path }) => `${path}::${file.size}::${file.lastModified}`)
    );

    for (const file of incoming) {
      const path = filePathForContext(file);
      const key = `${path}::${file.size}::${file.lastModified}`;

      if (existingKeys.has(key)) {
        duplicateCount += 1;
        continue;
      }

      if (!isAllowedContextFile(file)) {
        rejected.push(`${path} (unsupported type)`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(`${path} (>${formatBytes(MAX_FILE_SIZE_BYTES)})`);
        continue;
      }

      accepted.push({
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : key,
        file,
        path
      });
      existingKeys.add(key);
    }

    const availableSlots = Math.max(0, MAX_TOTAL_FILES - previousFiles.length);
    if (accepted.length > availableSlots) {
      const overflow = accepted.splice(availableSlots);
      for (const dropped of overflow) {
        rejected.push(`${dropped.path} (too many files)`);
      }
    }

    const nextFiles = [...previousFiles, ...accepted];
    contextFilesRef.current = nextFiles;
    setContextFiles(nextFiles);

    const messages = [];
    if (accepted.length > 0) {
      messages.push(`Added ${accepted.length} file(s).`);
    }
    if (duplicateCount > 0) {
      messages.push(`Skipped ${duplicateCount} duplicates.`);
    }
    if (rejected.length > 0) {
      messages.push(`Skipped ${rejected.length} unsupported/invalid file(s).`);
    }
    setUploadNotice(messages.join(" "));
  };

  const handleFilePickerChange = (event) => {
    addContextFiles(event.target.files);
    event.target.value = "";
  };

  const handleRemoveContextFile = (fileId) => {
    if (removeTimersRef.current.has(fileId)) return;

    setRemovingContextIds((prev) => {
      const next = new Set(prev);
      next.add(fileId);
      return next;
    });

    const timerId = window.setTimeout(() => {
      removeTimersRef.current.delete(fileId);
      setRemovingContextIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      setContextFiles((prev) => {
        const nextFiles = prev.filter((file) => file.id !== fileId);
        contextFilesRef.current = nextFiles;
        return nextFiles;
      });
      setPreviewTarget((current) => (current?.id === fileId ? null : current));
    }, CHIP_REMOVE_ANIMATION_MS);

    removeTimersRef.current.set(fileId, timerId);
  };

  const handleComposerSubmit = async (event) => {
    event.preventDefault();
    const filesForSubmit = contextFiles.filter((file) => !removingContextIds.has(file.id));

    if (!scenarioText.trim() && filesForSubmit.length === 0) {
      setSubmitNotice({
        kind: "warning",
        message: "Add a prompt or at least one context file before submitting."
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitNotice({ kind: "idle", message: "" });

    const formData = new FormData();
    formData.append("prompt", scenarioText.trim());
    formData.append(
      "context_manifest",
      JSON.stringify(
        filesForSubmit.map(({ path, file }) => ({
          path,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size
        }))
      )
    );
    filesForSubmit.forEach(({ file, path }) => {
      formData.append("context_files", file, path);
    });

    try {
      const response = await fetch(PLANNER_CONTEXT_ENDPOINT, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Planner endpoint responded ${response.status}`);
      }

      setSubmitNotice({
        kind: "success",
        message: `Submitted prompt + ${filesForSubmit.length} context file(s) to the planner.`
      });
    } catch (error) {
      setSubmitNotice({
        kind: "warning",
        message:
          `Could not reach planner endpoint (${PLANNER_CONTEXT_ENDPOINT}). ` +
          "Context files remain attached locally."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasSubmitNotice = submitNotice.kind !== "idle" && Boolean(submitNotice.message);
  const hasUploadNotice = Boolean(uploadNotice);
  const activeNoticeMessage = hasSubmitNotice ? submitNotice.message : hasUploadNotice ? uploadNotice : "";
  const activeNoticeVisible = hasSubmitNotice ? showSubmitNotice : hasUploadNotice ? showUploadNotice : false;
  const activeNoticeKind = hasSubmitNotice ? submitNotice.kind : "";

  return (
    <div className="app-shell">
      <DotWaveBackground />

      <input
        ref={fileInputRef}
        type="file"
        className="hidden-file-input"
        accept=".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.doc,.docx,.rtf,.png,.jpg,.jpeg,text/*,image/png,image/jpeg"
        multiple
        onChange={handleFilePickerChange}
      />

      <main className="main-panel">
        <LiveKitTester />
        <section className="hero">
          <div className="hero-copy">
            <h1>{displayTitle}</h1>
            <p className={`hero-subtitle ${showSubtitle ? "visible" : ""}`}>Simulate Anything</p>
          </div>

          <form className="composer-shell" onSubmit={handleComposerSubmit}>
            <div className={`composer-frame ${contextFiles.length > 0 ? "with-context" : ""}`}>
              <div
                className={`context-preview-wrapper ${contextFiles.length > 0 ? "visible" : "hidden"}`}
                aria-hidden={contextFiles.length === 0}
              >
                <div className="context-preview-row" aria-label="Attached context files">
                  {contextFiles.map((contextFile) => {
                    const isRemoving = removingContextIds.has(contextFile.id);
                    return (
                      <article
                        className={`context-chip ${isRemoving ? "removing" : ""}`}
                        key={contextFile.id}
                        ref={(node) => {
                          if (node) {
                            contextChipRefs.current.set(contextFile.id, node);
                            return;
                          }
                          contextChipRefs.current.delete(contextFile.id);
                        }}
                        role="button"
                        tabIndex={isRemoving ? -1 : 0}
                        onClick={() => {
                          if (isRemoving) return;
                          setPreviewTarget(contextFile);
                        }}
                        onKeyDown={(event) => {
                          if (isRemoving) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setPreviewTarget(contextFile);
                          }
                        }}
                      >
                        <div className="context-chip-top">
                          <p className="context-chip-name" title={contextFile.path}>
                            {fileNameFromPath(contextFile.path)}
                          </p>
                          <button
                            type="button"
                            className="context-chip-remove"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRemoveContextFile(contextFile.id);
                            }}
                            aria-label={`Remove ${contextFile.file.name}`}
                            disabled={isRemoving}
                          >
                            <img src={closeIcon} alt="" />
                          </button>
                        </div>
                        <p className="context-chip-meta">
                          {fileLabel(contextFile.file)} • {formatBytes(contextFile.file.size)}
                        </p>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="composer">
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Attach context files"
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                >
                  +
                </button>
                <input
                  type="text"
                  value={scenarioText}
                  onChange={(event) => setScenarioText(event.target.value)}
                  placeholder={placeholderText}
                  aria-label="Simulation scenario"
                />
                <button className="send-btn" type="submit" aria-label="Submit simulation" disabled={isSubmitting}>
                  <img src={arrowUpIcon} alt="" />
                </button>
              </div>
            </div>

            <p
              className={`context-note ${activeNoticeKind} ${activeNoticeVisible ? "visible" : "hidden"}`}
              aria-live={activeNoticeMessage ? "polite" : "off"}
            >
              {activeNoticeMessage || "\u00A0"}
            </p>
          </form>
        </section>
      </main>

      {previewTarget ? (
        <div
          className="preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Attachment preview"
          onClick={() => setPreviewTarget(null)}
        >
          <div className="preview-modal" onClick={(event) => event.stopPropagation()}>
            <header className="preview-header">
              <div className="preview-header-text">
                <p className="preview-title" title={previewTarget.path}>
                  {fileNameFromPath(previewTarget.path)}
                </p>
                <p className="preview-meta">
                  {fileLabel(previewTarget.file)} • {formatBytes(previewTarget.file.size)}
                </p>
              </div>
              <button
                type="button"
                className="preview-close-btn"
                onClick={() => setPreviewTarget(null)}
                aria-label="Close preview"
              >
                <img src={closeIcon} alt="" />
              </button>
            </header>

            <div className="preview-content">
              {previewMode === "image" ? <img src={previewUrl} alt={previewTarget.file.name} className="preview-image" /> : null}
              {previewMode === "pdf" ? (
                <iframe src={previewUrl} title={previewTarget.file.name} className="preview-pdf" />
              ) : null}
              {previewMode === "text-loading" ? <p className="preview-note">Loading preview...</p> : null}
              {previewMode === "text" ? <pre className="preview-text">{previewText}</pre> : null}
              {previewMode === "unsupported" ? (
                <div className="preview-unsupported">
                  <p className="preview-note">No inline preview is available for this file type.</p>
                  {previewUrl ? (
                    <a
                      className="preview-download-link"
                      href={previewUrl}
                      download={previewTarget.file.name}
                    >
                      Download file
                    </a>
                  ) : null}
                </div>
              ) : null}
              {previewError ? <p className="preview-note warning">{previewError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
