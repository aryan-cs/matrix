import { useEffect, useLayoutEffect, useRef, useState } from "react";
import DotWaveBackground from "./components/DotWaveBackground";
import AgentLiveAvatarCard from "./components/AgentLiveAvatarCard";
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
const FIRST_CHAT_REVEAL_DELAY_MS = 620;
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
const PLANNER_CONTEXT_STREAM_ENDPOINT =
  import.meta.env.VITE_PLANNER_CONTEXT_STREAM_ENDPOINT || "/api/planner/context/stream";
const NETWORK_BUILDER_ENDPOINT =
  import.meta.env.VITE_NETWORK_BUILDER_ENDPOINT || "/api/graph/from-csv-text";

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

function parseCsvLine(line) {
  const text = String(line || "");
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function textAfterFinalThinkTag(rawText) {
  const normalized = String(rawText || "").replace(/\r\n/g, "\n");
  const closeTagRegex = /<\/think\s*>/gi;
  let lastCloseEnd = -1;
  let match = closeTagRegex.exec(normalized);
  while (match) {
    lastCloseEnd = closeTagRegex.lastIndex;
    match = closeTagRegex.exec(normalized);
  }
  if (lastCloseEnd === -1) return normalized.trim();
  return normalized.slice(lastCloseEnd).trim();
}

function splitThinkContent(rawText, assumeThinking = false) {
  const text = String(rawText ?? "");
  const openMatch = /<think\s*>/i.exec(text);
  const closeMatch = /<\/think\s*>/i.exec(text);

  if (closeMatch && (!openMatch || closeMatch.index < openMatch.index)) {
    return {
      thinkingText: text.slice(0, closeMatch.index),
      finalText: text.slice(closeMatch.index + closeMatch[0].length)
    };
  }

  if (openMatch && closeMatch && closeMatch.index > openMatch.index) {
    const beforeOpen = text.slice(0, openMatch.index);
    const insideThink = text.slice(openMatch.index + openMatch[0].length, closeMatch.index);
    return {
      thinkingText: `${beforeOpen}${insideThink}`,
      finalText: text.slice(closeMatch.index + closeMatch[0].length)
    };
  }

  if (openMatch && !closeMatch) {
    return {
      thinkingText: `${text.slice(0, openMatch.index)}${text.slice(
        openMatch.index + openMatch[0].length
      )}`,
      finalText: ""
    };
  }

  if (assumeThinking) {
    return {
      thinkingText: text,
      finalText: ""
    };
  }

  return {
    thinkingText: "",
    finalText: text
  };
}

function extractCsvPayloadFromPlannerText(rawText) {
  const postThinkText = textAfterFinalThinkTag(rawText);
  if (!postThinkText) return "";

  const fencedMatch = postThinkText.match(/```(?:csv)?\s*\n([\s\S]*?)```/i);
  const candidate = (fencedMatch ? fencedMatch[1] : postThinkText).trim();
  if (!candidate) return "";

  const lines = candidate.replace(/\r\n/g, "\n").split("\n");
  let headerIndex = -1;
  let headerFieldCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || !line.includes(",")) continue;
    const lowered = line.toLowerCase();
    if (lowered.includes("agent_id") && lowered.includes("connections") && lowered.includes("system_prompt")) {
      headerIndex = i;
      headerFieldCount = parseCsvLine(line).length;
      break;
    }
  }

  if (headerIndex === -1 || headerFieldCount < 2) return "";

  const csvLines = [lines[headerIndex].trim()];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || !line.includes(",")) break;
    if (parseCsvLine(line).length !== headerFieldCount) break;
    csvLines.push(line);
  }

  return csvLines.length >= 2 ? csvLines.join("\n") : "";
}

function compactSnippet(text, maxChars = 180) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}...`;
}

function createLocalMessageId(prefix = "msg") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function plannerTextFromBody(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (typeof body.output_text === "string") return body.output_text;
  if (typeof body.completion === "string") return body.completion;
  const choiceContent = body?.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") return choiceContent;
  return "";
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdownToHtml(text) {
  let html = escapeHtml(text);
  const codeTokens = [];

  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    const token = `@@CODE_TOKEN_${codeTokens.length}@@`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  codeTokens.forEach((token, index) => {
    html = html.replace(`@@CODE_TOKEN_${index}@@`, token);
  });

  return html;
}

function markdownToHtml(text) {
  const input = String(text ?? "").replace(/\r\n/g, "\n");
  if (!input.trim()) return "";

  const lines = input.split("\n");
  const blocks = [];
  let index = 0;

  const isSpecialStart = (line) =>
    /^#{1,6}\s+/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^(```)/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line);

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      index += 1;
      const codeLines = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      blocks.push(
        `<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${inlineMarkdownToHtml(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push("<hr />");
      index += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        const match = candidate.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${inlineMarkdownToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        const match = candidate.match(/^\d+\.\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${inlineMarkdownToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const candidateRaw = lines[index];
      const candidate = candidateRaw.trim();
      if (!candidate) break;
      if (paragraphLines.length > 0 && isSpecialStart(candidate)) break;
      paragraphLines.push(inlineMarkdownToHtml(candidateRaw));
      index += 1;
    }
    blocks.push(`<p>${paragraphLines.join("<br />")}</p>`);
  }

  return blocks.join("");
}

function App() {
  const [displayTitle, setDisplayTitle] = useState(TITLE_TEXT);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [scenarioText, setScenarioText] = useState("");
  const [chatStarted, setChatStarted] = useState(false);
  const [messages, setMessages] = useState([]);
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
  const [expandedThinkingIds, setExpandedThinkingIds] = useState(() => new Set());
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
  const chatScrollRef = useRef(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

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
    if (chatStarted) {
      if (placeholderText !== "") {
        setPlaceholderText("");
      }
      return undefined;
    }

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
  }, [isDeleting, placeholderText, promptIndex, chatStarted]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, autoScrollEnabled]);

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

  const updateAssistantMessage = (assistantMessageId, patch) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              ...patch
            }
          : message
      )
    );
  };

  const setThinkingPanelExpanded = (messageId, expanded) => {
    setExpandedThinkingIds((prev) => {
      const next = new Set(prev);
      if (expanded) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return next;
    });
  };

  const streamPlannerText = async ({ formData, assistantMessageId }) => {
    const response = await fetch(PLANNER_CONTEXT_STREAM_ENDPOINT, {
      method: "POST",
      body: formData
    });

    if (response.status === 404) {
      const fallbackResponse = await fetch(PLANNER_CONTEXT_ENDPOINT, {
        method: "POST",
        body: formData
      });
      if (!fallbackResponse.ok) {
        throw new Error(`Planner endpoint responded ${fallbackResponse.status}`);
      }
      const contentType = fallbackResponse.headers.get("content-type") || "";
      const rawText = contentType.includes("application/json")
        ? plannerTextFromBody(await fallbackResponse.json())
        : await fallbackResponse.text();
      updateAssistantMessage(assistantMessageId, {
        content: rawText || "Planner returned an empty response.",
        thinking: false,
        error: false
      });
      setThinkingPanelExpanded(assistantMessageId, false);
      return rawText;
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
      throw new Error(
        `Planner endpoint responded ${response.status}${
          detail ? `: ${compactSnippet(detail, 240)}` : ""
        }`
      );
    }

    if (!response.body) {
      const fallbackText = await response.text();
      updateAssistantMessage(assistantMessageId, {
        content: fallbackText || "Planner returned an empty response.",
        thinking: false,
        error: false
      });
      setThinkingPanelExpanded(assistantMessageId, false);
      return fallbackText;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let aggregateText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let delimiterIndex = buffer.indexOf("\n\n");
      while (delimiterIndex !== -1) {
        const eventChunk = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);

        const lines = eventChunk
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        for (const line of lines) {
          if (!line) continue;
          if (line === "[DONE]") {
            setThinkingPanelExpanded(assistantMessageId, false);
            updateAssistantMessage(assistantMessageId, {
              content: aggregateText || "Planner returned an empty response.",
              thinking: false,
              error: false
            });
            return aggregateText;
          }

          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }

          const chunkError = parsed?.error;
          if (chunkError) {
            throw new Error(String(chunkError));
          }

          const delta =
            parsed?.delta ||
            parsed?.choices?.[0]?.delta?.content ||
            parsed?.choices?.[0]?.message?.content ||
            "";

          if (!delta) continue;
          aggregateText += String(delta);
          const hasThinkCloseTag = /<\/think\s*>/i.test(aggregateText);
          setThinkingPanelExpanded(assistantMessageId, !hasThinkCloseTag);
          updateAssistantMessage(assistantMessageId, {
            content: aggregateText,
            thinking: !hasThinkCloseTag,
            error: false
          });
        }

        delimiterIndex = buffer.indexOf("\n\n");
      }
    }

    updateAssistantMessage(assistantMessageId, {
      content: aggregateText || "Planner returned an empty response.",
      thinking: false,
      error: false
    });
    setThinkingPanelExpanded(assistantMessageId, false);
    return aggregateText;
  };

  const handleComposerSubmit = async (event) => {
    event.preventDefault();
    const filesForSubmit = contextFiles.filter((file) => !removingContextIds.has(file.id));
    const promptText = scenarioText.trim();

    if (!promptText && filesForSubmit.length === 0) {
      setSubmitNotice({
        kind: "warning",
        message: "Add a prompt or at least one context file before submitting."
      });
      return;
    }

    const assistantMessageId = createLocalMessageId("assistant");
    const userMessageText = promptText || `Attached ${filesForSubmit.length} context file(s).`;
    const firstEntry = !chatStarted;

    setChatStarted(true);
    setAutoScrollEnabled(true);
    setScenarioText("");
    setIsSubmitting(true);
    setSubmitNotice({ kind: "idle", message: "" });

    if (firstEntry) {
      await delay(FIRST_CHAT_REVEAL_DELAY_MS);
    }

    setThinkingPanelExpanded(assistantMessageId, true);
    setMessages((prev) => [
      ...prev,
      {
        id: createLocalMessageId("user"),
        role: "user",
        content: userMessageText,
        thinking: false,
        error: false
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "Thinking...",
        thinking: true,
        error: false
      }
    ]);

    const formData = new FormData();
    formData.append(
      "prompt",
      promptText || "Use the attached context files to generate representative simulation agents."
    );
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
      const plannerText = await streamPlannerText({
        formData,
        assistantMessageId
      });
      const csvPayload = extractCsvPayloadFromPlannerText(plannerText);

      if (!csvPayload) {
        setSubmitNotice({
          kind: "warning",
          message:
            "Planner response rendered, but no valid CSV block was detected after </think>. " +
            `Preview: "${compactSnippet(textAfterFinalThinkTag(plannerText))}"`
        });
        return;
      }

      const graphResponse = await fetch(NETWORK_BUILDER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          csv_text: csvPayload,
          directed: false
        })
      });

      if (!graphResponse.ok) {
        let detail = "";
        try {
          const payload = await graphResponse.json();
          detail = payload?.detail || "";
        } catch {
          detail = "";
        }
        throw new Error(
          `Network builder responded ${graphResponse.status}${detail ? `: ${detail}` : ""}`
        );
      }

      const graph = await graphResponse.json();
      window.__MATRIX_LAST_GRAPH__ = graph;

      setSubmitNotice({
        kind: "success",
        message: `Built graph with ${graph?.stats?.node_count ?? 0} nodes and ${graph?.stats?.edge_count ?? 0} edges.`
      });
    } catch (error) {
      updateAssistantMessage(assistantMessageId, {
        content: error?.message || "Planner/network pipeline failed.",
        thinking: false,
        error: true
      });
      setSubmitNotice({
        kind: "warning",
        message: error?.message || "Planner/network pipeline failed."
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
        <AgentLiveAvatarCard />
        <section className="hero">
          <div className="hero-copy">
            <h1>{displayTitle}</h1>
            <p className={`hero-subtitle ${showSubtitle ? "visible" : ""}`}>Simulate Anything</p>
          </div>

          <div
            className={`chat-thread ${chatStarted ? "visible" : "hidden"}`}
            ref={chatScrollRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
              setAutoScrollEnabled(distanceFromBottom < 52);
            }}
          >
            <div className="chat-thread-inner">
              {messages.map((message) => (
                (() => {
                  const isAssistant = message.role === "assistant";
                  const { thinkingText, finalText } = isAssistant
                    ? splitThinkContent(message.content, message.thinking)
                    : { thinkingText: "", finalText: message.content };
                  const hasThinkingTrace = Boolean(thinkingText.trim());
                  const finalBodyText = finalText.trim();
                  const isThinkingExpanded =
                    hasThinkingTrace && (expandedThinkingIds.has(message.id) || message.thinking);
                  const thinkingHtml = hasThinkingTrace ? markdownToHtml(thinkingText.trim()) : "";
                  const finalHtml = finalBodyText ? markdownToHtml(finalBodyText) : "";
                  const plainHtml = !isAssistant ? markdownToHtml(message.content) : "";

                  return (
                    <article
                      key={message.id}
                      className={`chat-message ${message.role} ${message.thinking ? "thinking" : ""} ${
                        message.error ? "error" : ""
                      }`}
                    >
                      {isAssistant && hasThinkingTrace ? (
                        <div className="thinking-panel">
                          <button
                            type="button"
                            className="thinking-toggle"
                            aria-expanded={isThinkingExpanded}
                            onClick={() =>
                              setThinkingPanelExpanded(message.id, !isThinkingExpanded)
                            }
                          >
                            <span
                              className={`thinking-caret ${
                                isThinkingExpanded ? "expanded" : ""
                              }`}
                              aria-hidden="true"
                            >
                              ▸
                            </span>
                            <span className="thinking-toggle-label">
                              {message.thinking ? "Thinking..." : "Thought process"}
                            </span>
                          </button>
                          <div
                            className={`thinking-content ${
                              isThinkingExpanded ? "expanded" : "collapsed"
                            }`}
                          >
                            <div
                              className="chat-message-text markdown-body chat-thinking-text"
                              dangerouslySetInnerHTML={{ __html: thinkingHtml }}
                            />
                          </div>
                        </div>
                      ) : null}
                      {isAssistant && finalBodyText ? (
                        <div
                          className="chat-message-text markdown-body"
                          dangerouslySetInnerHTML={{ __html: finalHtml }}
                        />
                      ) : null}
                      {!isAssistant ? (
                        <div
                          className="chat-message-text markdown-body"
                          dangerouslySetInnerHTML={{ __html: plainHtml }}
                        />
                      ) : null}
                      {isAssistant && !hasThinkingTrace && !finalBodyText ? (
                        <div
                          className="chat-message-text markdown-body"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }}
                        />
                      ) : null}
                    </article>
                  );
                })()
              ))}
            </div>
          </div>

          <form className={`composer-shell ${chatStarted ? "docked" : ""}`} onSubmit={handleComposerSubmit}>
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
