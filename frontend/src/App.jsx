import { useEffect, useState } from "react";
import DotWaveBackground from "./components/DotWaveBackground";
import arrowUpIcon from "../assets/icons/arrow-up.svg";

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

function App() {
  const [displayTitle, setDisplayTitle] = useState(TITLE_TEXT);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [placeholderText, setPlaceholderText] = useState(
    examplePrompts[0].startsWith(SHARED_PREFIX) ? SHARED_PREFIX : ""
  );
  const [promptIndex, setPromptIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

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

  return (
    <div className="app-shell">
      <DotWaveBackground />

      <main className="main-panel">
        <section className="hero">
          <div className="hero-copy">
            <h1>{displayTitle}</h1>
            <p className={`hero-subtitle ${showSubtitle ? "visible" : ""}`}>Simulate Anything</p>
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <button className="icon-btn" type="button" aria-label="Attach scenario data">
              +
            </button>
            <input
              type="text"
              placeholder={placeholderText}
              aria-label="Simulation scenario"
            />
            <button className="send-btn" type="submit" aria-label="Submit simulation">
              <img src={arrowUpIcon} alt="" />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default App;
