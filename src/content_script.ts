import { SpeechManager } from "./speech";
import {
  sendToInterviewer,
  InterviewSession,
  Message,
  Phase,
  PHASE_LABELS,
  PHASE_ORDER,
  getNextPhase,
} from "./interviewer";
import { TTSManager } from "./tts";

interface ProblemData {
  title: string;
  difficulty: string;
  description: string;
  tags: string[];
  url: string;
}

const extractProblemData = (): ProblemData | null => {
  const titleEl =
    document.querySelector('[data-cy="question-title"]') ||
    document.querySelector(".text-title-large") ||
    document.querySelector('[class*="title_"]:not([class*="nav"])');

  const difficultyEl =
    document.querySelector("[diff]") ||
    document.querySelector(
      ".text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard",
    ) ||
    document.querySelector('[class*="difficulty"]');

  const descriptionEl =
    document.querySelector('[data-key="description-content"]') ||
    document.querySelector(".elfjS") ||
    document.querySelector('[class*="description_"]');

  const tagEls = document.querySelectorAll(
    'a[href*="/tag/"], [class*="topic-tag"], [class*="tag_"]',
  );

  if (!titleEl) return null;

  return {
    title: titleEl.textContent?.trim() ?? "Unknown",
    difficulty: difficultyEl?.textContent?.trim() ?? "Unknown",
    description: descriptionEl?.textContent?.trim().slice(0, 300) ?? "",
    tags: Array.from(tagEls)
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean),
    url: window.location.href,
  };
};

const getEditorCode = (): string => {
  const lines = document.querySelectorAll(".view-line");
  if (lines.length > 0) {
    return Array.from(lines)
      .map((el) => el.textContent ?? "")
      .filter((line) => line.trim() !== "")
      .join("\n")
      .trim();
  }
  const monaco = (window as any).monaco;
  if (monaco) {
    const editors = monaco.editor.getEditors();
    if (editors.length > 0) return editors[0].getValue();
  }
  return "";
};

const getDifficultyStyles = (d: string) =>
  d === "Easy"
    ? { bg: "#1a2e1a", color: "#4ac94a", border: "#2a4a2a" }
    : d === "Medium"
      ? { bg: "#2e2200", color: "#ffa116", border: "#4a3800" }
      : { bg: "#2e1a1a", color: "#e05252", border: "#4a2a2a" };

const speech = new SpeechManager();
let transcript = "";
let currentSession: InterviewSession | null = null;
let conversationHistory: Message[] = [];
const tts = new TTSManager();

const getTranscriptBox = (): HTMLTextAreaElement =>
  document.getElementById("ic-transcript") as HTMLTextAreaElement;

const updatePanel = (data: ProblemData): void => {
  const titleEl = document.getElementById("ic-title");
  const diffEl = document.getElementById("ic-difficulty");
  const tagsEl = document.getElementById("ic-tags");

  if (titleEl) titleEl.textContent = data.title;

  if (diffEl) {
    const { bg, color, border } = getDifficultyStyles(data.difficulty) as any;
    diffEl.textContent = data.difficulty;
    diffEl.style.cssText = `
      display:inline-block;padding:2px 7px;border-radius:4px;
      font-size:10px;font-weight:700;
      background:${bg};color:${color};border:1px solid ${border};
      font-family:monospace;letter-spacing:0.04em;
    `;
  }

  if (tagsEl) {
    tagsEl.innerHTML = data.tags
      .slice(0, 4)
      .map(
        (tag) => `<span style="
          display:inline-block;
          background:#222;color:#666;
          font-size:10px;padding:2px 6px;
          border-radius:4px;margin:2px 2px 0 0;
          border:1px solid #2e2e2e;
          font-family:monospace;
        ">${tag}</span>`,
      )
      .join("");
  }

  currentSession = {
    problemTitle: data.title,
    problemDifficulty: data.difficulty,
    problemTags: data.tags,
    messages: [],
    hintLevel: 1,
    phase: "clarify",
  };
  conversationHistory = [];
  renderPhaseBar("clarify");
};

const renderPhaseBar = (currentPhase: Phase): void => {
  const bar = document.getElementById("ic-phase-bar");
  if (!bar) return;

  bar.innerHTML = PHASE_ORDER.map((phase) => {
    const isActive = phase === currentPhase;
    const isDone =
      PHASE_ORDER.indexOf(phase) < PHASE_ORDER.indexOf(currentPhase);
    const bg = isDone ? "#1a2e1a" : isActive ? "#ffa116" : "#222";
    const color = isDone ? "#4a9a4a" : isActive ? "#1a1a1a" : "#444";
    const border = isDone ? "#2a4a2a" : isActive ? "#ffa116" : "#333";

    return `<div class="ic-phase-pill" data-phase="${phase}" style="
      flex:1;text-align:center;padding:5px 2px;
      background:${bg};color:${color};
      font-size:9px;font-weight:700;
      border-radius:5px;
      border:1px solid ${border};
      cursor:pointer;
      letter-spacing:0.04em;
      font-family:monospace;
    ">${PHASE_LABELS[phase]}</div>`;
  }).join("");

  bar.querySelectorAll("[data-phase]").forEach((el) => {
    el.addEventListener("click", () => {
      const phase = (el as HTMLElement).dataset.phase as Phase;
      if (!currentSession) return;
      jumpToPhase(phase);
    });
  });
};

const addChatMessage = (role: "YOU" | "INTERVIEWER", text: string): void => {
  const chatBox = document.getElementById("ic-chat");
  if (!chatBox) return;

  const isUser = role === "YOU";
  chatBox.style.display = "block";
  chatBox.innerHTML += `
    <div class="ic-msg" style="margin-bottom:8px;">
      <div style="
        font-size:9px;font-weight:700;letter-spacing:0.08em;
        color:${isUser ? "#ffa116" : "#555"};
        margin-bottom:3px;font-family:monospace;
      ">${role}</div>
      <div style="
        background:${isUser ? "#1e2a1a" : "#1e1e1e"};
        border:1px solid ${isUser ? "#2a3a2a" : "#2e2e2e"};
        border-radius:6px;padding:7px 9px;
        font-size:12px;
        color:${isUser ? "#7ec87e" : "#ccc"};
        line-height:1.5;
      ">${text}</div>
    </div>
  `;
  chatBox.scrollTop = chatBox.scrollHeight;
};

const updateNextPhaseBtn = (phase: Phase): void => {
  const btn = document.getElementById("ic-next-phase-btn") as HTMLButtonElement;
  if (!btn) return;
  const next = getNextPhase(phase);
  if (next) {
    btn.style.display = "block";
    btn.textContent = `NEXT: ${PHASE_LABELS[next]} →`;
  } else {
    btn.textContent = "SESSION COMPLETE ✓";
    btn.style.color = "#4ac94a";
    btn.style.borderColor = "#4ac94a";
    btn.style.display = "block";
  }
};

const jumpToPhase = (phase: Phase): void => {
  if (!currentSession) return;

  currentSession.phase = phase;
  currentSession.hintLevel = 1;
  conversationHistory = [];
  currentSession.messages = [];

  renderPhaseBar(phase);

  const nextPhaseBtn = document.getElementById("ic-next-phase-btn");
  const reviewBtn = document.getElementById("ic-review-btn");

  if (nextPhaseBtn) nextPhaseBtn.style.display = "none";
  if (reviewBtn) {
    reviewBtn.style.display =
      phase === "code" || phase === "optimize" ? "block" : "none";
  }

  const chatBox = document.getElementById("ic-chat");
  if (chatBox) {
    chatBox.innerHTML = "";
    chatBox.style.display = "block";
  }

  const tb = getTranscriptBox();
  if (tb) {
    tb.value = "";
    tb.style.display = "none";
  }
  transcript = "";

  const sendBtn = document.getElementById("ic-send-btn");
  if (sendBtn) sendBtn.style.display = "none";

  const phaseIntros: Record<Phase, string> = {
    clarify:
      "Before we start — what clarifying questions do you have about the problem?",
    brute:
      "Good. Now walk me through a brute force approach. Don't worry about optimization yet.",
    optimize:
      "What's the bottleneck in your brute force? Where is the repeated work?",
    code: "Go ahead and code it up. Talk me through your logic as you write.",
  };

  addChatMessage("INTERVIEWER", phaseIntros[phase]);
  tts.speak(phaseIntros[phase]);
};

const injectPanel = (): void => {
  if (document.getElementById("intuitcode-panel")) return;

  const style = document.createElement("style");
  style.textContent = `
    #intuitcode-panel * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', sans-serif; }
    #intuitcode-panel { scrollbar-width: thin; scrollbar-color: #3a3a3a #1a1a1a; }
    #intuitcode-panel ::-webkit-scrollbar { width: 4px; }
    #intuitcode-panel ::-webkit-scrollbar-track { background: #1a1a1a; }
    #intuitcode-panel ::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }
    #ic-mic-btn:hover { opacity: 0.88; }
    #ic-send-btn:hover { opacity: 0.88; }
    #ic-next-phase-btn:hover { opacity: 0.88; }
    #ic-review-btn:hover { opacity: 0.88; }
    #ic-text-submit:hover { opacity: 0.88; }
    .ic-phase-pill { transition: background 0.15s, color 0.15s; }
    .ic-phase-pill:hover { opacity: 0.85; }
    #ic-chat .ic-msg { animation: icFadeIn 0.18s ease; }
    @keyframes icFadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
    #ic-text-input:focus { border-color: #ffa116 !important; outline: none; }
    #ic-transcript:focus { border-color: #ffa116 !important; outline: none; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "intuitcode-panel";
  panel.style.cssText = `
    position:fixed;bottom:24px;right:24px;width:340px;
    background:#1a1a1a;
    border:1px solid #3a3a3a;
    border-radius:12px;
    padding:0;
    z-index:99999;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);
    overflow:hidden;
    transition:none;
  `;

  panel.innerHTML = `
    <div id="ic-header" style="
      display:flex;align-items:center;justify-content:space-between;
      padding:11px 14px 10px;
      background:#222;
      border-bottom:1px solid #2e2e2e;
      cursor:grab;user-select:none;
      flex-shrink:0;
    ">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="
          font-size:11px;font-weight:700;letter-spacing:0.08em;
          color:#ffa116;text-transform:uppercase;font-family:monospace;
          white-space:nowrap;
        ">IntuitCode</span>
        <span id="ic-difficulty" style="font-size:10px;"></span>
      </div>
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="ic-mute-btn" style="
          background:none;border:none;cursor:pointer;
          font-size:13px;color:#555;padding:2px 5px;
          border-radius:4px;line-height:1;
        " title="Toggle voice">🔊</button>
        <button id="ic-minimize-btn" style="
          background:none;border:none;cursor:pointer;
          font-size:16px;color:#888;padding:2px 5px;
          border-radius:4px;line-height:1;
        ">&#8722;</button>
      </div>
    </div>

    <div id="ic-body" style="
      display:block;
      overflow-y:auto;
      height:calc(100% - 44px);
    ">
      <div style="padding:10px 14px 8px;border-bottom:1px solid #2a2a2a;">
        <div id="ic-title" style="
          font-size:13px;font-weight:600;color:#e5e5e5;
          margin-bottom:5px;line-height:1.3;
        ">Detecting problem...</div>
        <div id="ic-tags"></div>
      </div>

      <div id="ic-phase-bar" style="
        display:flex;gap:3px;padding:10px 14px 0;
        flex-shrink:0;
      "></div>

      <div id="ic-chat" style="
        display:none;
        max-height:168px;overflow-y:auto;
        margin:10px 14px 0;
        background:#111;
        border:1px solid #2a2a2a;
        border-radius:8px;
        padding:8px;
      "></div>

      <div style="padding:10px 14px 14px;">
        <p id="ic-status" style="
          font-size:11px;color:#555;margin:0 0 8px;
          letter-spacing:0.02em;
        ">Speak or type — edit before sending</p>

        <textarea id="ic-transcript" placeholder="Your words appear here — edit to fix any misheard words before sending..." style="
          display:none;
          width:100%;
          min-height:60px;max-height:80px;
          overflow-y:auto;
          background:#111;
          border:1px solid #2a2a2a;
          border-radius:6px;
          padding:7px 9px;
          font-size:12px;color:#ccc;
          margin-bottom:8px;
          font-style:normal;
          line-height:1.5;
          resize:none;
          font-family:monospace;
        "></textarea>

        <div id="ic-text-input-row" style="display:flex;gap:6px;margin-bottom:6px;">
          <input id="ic-text-input" type="text" placeholder="Or type here instead..." style="
            flex:1;padding:7px 9px;
            background:#111;color:#ccc;
            border:1px solid #2a2a2a;border-radius:7px;
            font-size:12px;font-family:monospace;
          "/>
          <button id="ic-text-submit" style="
            padding:7px 12px;
            background:#2a2a2a;color:#ffa116;
            border:1px solid #3a3a3a;border-radius:7px;
            font-size:13px;font-weight:700;
            cursor:pointer;
          ">&#8594;</button>
        </div>

        <button id="ic-mic-btn" style="
          width:100%;padding:8px;
          background:#ffa116;color:#1a1a1a;
          border:none;border-radius:7px;
          font-size:12px;font-weight:700;
          cursor:pointer;margin-bottom:6px;
          letter-spacing:0.03em;
        ">&#9679; START SPEAKING</button>

        <button id="ic-send-btn" style="
          width:100%;padding:8px;
          background:#2a2a2a;color:#e5e5e5;
          border:1px solid #3a3a3a;border-radius:7px;
          font-size:12px;font-weight:600;
          cursor:pointer;display:none;margin-bottom:6px;
          letter-spacing:0.02em;
        ">SEND TO INTERVIEWER &#8594;</button>

        <button id="ic-next-phase-btn" style="
          width:100%;padding:7px;
          background:transparent;color:#ffa116;
          border:1px solid #ffa116;border-radius:7px;
          font-size:11px;font-weight:700;
          cursor:pointer;display:none;margin-bottom:6px;
          letter-spacing:0.04em;
        "></button>

        <button id="ic-review-btn" style="
          width:100%;padding:7px;
          background:transparent;color:#888;
          border:1px solid #333;border-radius:7px;
          font-size:11px;font-weight:700;
          cursor:pointer;display:none;
          letter-spacing:0.04em;
        ">&#128269; REVIEW MY CODE</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  const header = document.getElementById("ic-header")!;
  const body = document.getElementById("ic-body")!;
  const minimizeBtn = document.getElementById("ic-minimize-btn")!;
  const muteBtn = document.getElementById("ic-mute-btn")!;
  const micBtn = document.getElementById("ic-mic-btn")!;
  const sendBtn = document.getElementById("ic-send-btn")!;
  const nextPhaseBtn = document.getElementById("ic-next-phase-btn")!;
  const reviewBtn = document.getElementById("ic-review-btn")!;
  const textInput = document.getElementById(
    "ic-text-input",
  ) as HTMLInputElement;
  const textSubmit = document.getElementById("ic-text-submit")!;

  let minimized = false;

  minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    minimized = !minimized;
    if (minimized) {
      body.style.display = "none";
      minimizeBtn.innerHTML = "&#43;";
      minimizeBtn.style.color = "#ffa116";
      panel.style.width = "auto";
      panel.style.minWidth = "180px";
      panel.style.height = "auto";
    } else {
      body.style.display = "block";
      minimizeBtn.innerHTML = "&#8722;";
      minimizeBtn.style.color = "#888";
      panel.style.width = "340px";
      panel.style.minWidth = "unset";
      panel.style.height = "auto";
    }
  });

  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    tts.toggle();
    muteBtn.textContent = tts.isEnabled ? "🔊" : "🔇";
  });

  speech.onStateChange((listening: boolean) => {
    const status = document.getElementById("ic-status");
    if (listening) {
      micBtn.style.background = "#cc3333";
      micBtn.style.color = "#fff";
      micBtn.textContent = "■ STOP";
      if (status) {
        status.textContent = "Listening — edit transcript if needed...";
        status.style.color = "#cc3333";
      }
    } else {
      micBtn.style.background = "#ffa116";
      micBtn.style.color = "#1a1a1a";
      micBtn.textContent = "● START SPEAKING";
      if (status) {
        status.textContent = "Speak or type — edit before sending";
        status.style.color = "#555";
      }
    }
  });

  speech.onResult(
    ({ transcript: t, isFinal }: { transcript: string; isFinal: boolean }) => {
      const tb = getTranscriptBox();
      tb.style.display = "block";
      if (isFinal) {
        transcript += t + " ";
        tb.value = transcript;
        sendBtn.style.display = "block";
      } else {
        tb.value = transcript + t;
      }
      tb.scrollTop = tb.scrollHeight;
    },
  );

  speech.onError((err: string) => {
    const status = document.getElementById("ic-status");
    if (status) {
      status.textContent = `Mic error: ${err}`;
      status.style.color = "#cc3333";
    }
  });

  const submitTextInput = (): void => {
    const text = textInput.value.trim();
    if (!text || !currentSession) return;
    const tb = getTranscriptBox();
    transcript = text;
    tb.style.display = "block";
    tb.value = text;
    sendBtn.style.display = "block";
    textInput.value = "";
  };

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitTextInput();
  });

  textSubmit.addEventListener("click", submitTextInput);

  textInput.addEventListener("focus", () => tts.stop());

  micBtn.addEventListener("click", () => {
    tts.stop();
    speech.toggle();
    const tb = getTranscriptBox();
    if (!speech.listening && tb.value.trim()) {
      sendBtn.style.display = "block";
    }
  });

  sendBtn.addEventListener("click", async () => {
    const tb = getTranscriptBox();
    const editedTranscript = tb.value.trim();
    if (!editedTranscript || !currentSession) return;
    speech.stop();

    const code = getEditorCode();
    const userText = editedTranscript;

    addChatMessage("YOU", userText);
    sendBtn.style.display = "none";
    transcript = "";
    tb.value = "";
    tb.style.display = "none";

    const chatBox = document.getElementById("ic-chat")!;
    chatBox.innerHTML += `<div style="font-size:11px;color:#444;font-style:italic;padding:2px 0;" id="ic-thinking">thinking...</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
      conversationHistory.push({ role: "user", parts: [{ text: userText }] });
      currentSession.messages = conversationHistory;

      const reply = await sendToInterviewer(currentSession, userText, code);

      conversationHistory.push({
        role: "model",
        parts: [{ text: reply }],
      });
      currentSession.hintLevel = Math.min(currentSession.hintLevel + 1, 3);

      document.getElementById("ic-thinking")?.remove();
      addChatMessage("INTERVIEWER", reply);
      tts.speak(reply);
      updateNextPhaseBtn(currentSession.phase);
    } catch (err) {
      document.getElementById("ic-thinking")?.remove();
      addChatMessage(
        "INTERVIEWER",
        "Could not reach interviewer. Check your connection.",
      );
      sendBtn.style.display = "block";
      console.error("IntuitCode API error:", err);
    }
  });

  nextPhaseBtn.addEventListener("click", () => {
    if (!currentSession) return;
    const next = getNextPhase(currentSession.phase);
    if (!next) {
      addChatMessage(
        "INTERVIEWER",
        "Great session — you've completed all 4 phases.",
      );
      nextPhaseBtn.style.display = "none";
      return;
    }
    jumpToPhase(next);
  });

  reviewBtn.addEventListener("click", async () => {
    if (!currentSession) return;

    const code = getEditorCode();
    if (!code || code.length < 30) {
      addChatMessage(
        "INTERVIEWER",
        "I don't see enough code yet. Write out your approach and I'll review it.",
      );
      return;
    }

    reviewBtn.style.color = "#555";
    reviewBtn.textContent = "Reviewing...";

    const chatBox = document.getElementById("ic-chat")!;
    chatBox.innerHTML += `<div id="ic-review-thinking" style="font-size:11px;color:#444;font-style:italic;padding:2px 0;">reading your code...</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
      const reviewPrompt = `Please review my current code:\n\`\`\`\n${code}\n\`\`\``;

      conversationHistory.push({
        role: "user",
        parts: [{ text: reviewPrompt }],
      });
      currentSession.messages = conversationHistory;

      const reply = await sendToInterviewer(currentSession, reviewPrompt, code);

      conversationHistory.push({
        role: "model",
        parts: [{ text: reply }],
      });

      document.getElementById("ic-review-thinking")?.remove();
      addChatMessage("INTERVIEWER", `💻 ${reply}`);
      tts.speak(reply);
    } catch (err) {
      document.getElementById("ic-review-thinking")?.remove();
      addChatMessage(
        "INTERVIEWER",
        "Could not review code. Check your connection.",
      );
      console.error(err);
    } finally {
      reviewBtn.style.color = "#888";
      reviewBtn.textContent = "⌕ REVIEW MY CODE";
    }
  });

  // Drag
  let isDragging = false;
  let isResizing = false;
  let dragStartX = 0,
    dragStartY = 0,
    panelStartX = 0,
    panelStartY = 0;
  let resizeStartX = 0,
    resizeStartY = 0,
    resizeStartW = 0,
    resizeStartH = 0,
    resizeFromLeft = false;

  header.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = panel.getBoundingClientRect();
    panelStartX = rect.left;
    panelStartY = rect.top;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = `${panelStartX}px`;
    panel.style.top = `${panelStartY}px`;
    header.style.cursor = "grabbing";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      panel.style.left = `${Math.max(0, Math.min(panelStartX + e.clientX - dragStartX, window.innerWidth - panel.offsetWidth))}px`;
      panel.style.top = `${Math.max(0, Math.min(panelStartY + e.clientY - dragStartY, window.innerHeight - panel.offsetHeight))}px`;
    }
    if (isResizing) {
      const dx = e.clientX - resizeStartX;
      const dy = e.clientY - resizeStartY;
      const newH = Math.max(320, resizeStartH + dy);
      if (resizeFromLeft) {
        const newW = Math.max(280, resizeStartW - dx);
        const rect = panel.getBoundingClientRect();
        panel.style.left = `${rect.left + (panel.offsetWidth - newW)}px`;
        panel.style.width = `${newW}px`;
      } else {
        panel.style.width = `${Math.max(280, resizeStartW + dx)}px`;
      }
      panel.style.height = `${newH}px`;
      const chatBox = document.getElementById("ic-chat");
      if (chatBox) chatBox.style.maxHeight = `${Math.max(80, newH - 280)}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    isResizing = false;
    header.style.cursor = "grab";
  });

  // Resize handles
  const resizeHandleLeft = document.createElement("div");
  resizeHandleLeft.style.cssText = `
    position:absolute;bottom:0;left:0;
    width:16px;height:16px;cursor:sw-resize;z-index:10;
  `;
  resizeHandleLeft.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"
    style="opacity:0.25;position:absolute;bottom:3px;left:3px;">
    <line x1="0" y1="10" x2="10" y2="0" stroke="#ffa116" stroke-width="1.5"/>
    <line x1="0" y1="6" x2="6" y2="0" stroke="#ffa116" stroke-width="1.5"/>
  </svg>`;
  panel.appendChild(resizeHandleLeft);

  const resizeHandleRight = document.createElement("div");
  resizeHandleRight.style.cssText = `
    position:absolute;bottom:0;right:0;
    width:16px;height:16px;cursor:se-resize;z-index:10;
  `;
  resizeHandleRight.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"
    style="opacity:0.25;position:absolute;bottom:3px;right:3px;">
    <line x1="0" y1="10" x2="10" y2="0" stroke="#ffa116" stroke-width="1.5"/>
    <line x1="4" y1="10" x2="10" y2="4" stroke="#ffa116" stroke-width="1.5"/>
  </svg>`;
  panel.appendChild(resizeHandleRight);

  const startResize = (e: MouseEvent, fromLeft: boolean): void => {
    isResizing = true;
    resizeFromLeft = fromLeft;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = panel.offsetWidth;
    resizeStartH = panel.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  };

  resizeHandleLeft.addEventListener("mousedown", (e) => startResize(e, true));
  resizeHandleRight.addEventListener("mousedown", (e) => startResize(e, false));
};

const tryExtract = (): void => {
  const data = extractProblemData();
  if (data) updatePanel(data);
};

const init = (): void => {
  injectPanel();
  tryExtract();

  let lastUrl = window.location.href;
  let extractTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;

    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;

      const tb = getTranscriptBox();
      const sendBtn = document.getElementById("ic-send-btn");
      if (tb) {
        tb.value = "";
        tb.style.display = "none";
      }
      if (sendBtn) sendBtn.style.display = "none";
      transcript = "";

      if (extractTimer) clearTimeout(extractTimer);
      extractTimer = setTimeout(() => {
        const newData = extractProblemData();
        if (newData && newData.title !== currentSession?.problemTitle) {
          conversationHistory = [];
          const chatBox = document.getElementById("ic-chat");
          const nextPhaseBtn = document.getElementById("ic-next-phase-btn");
          const reviewBtn = document.getElementById("ic-review-btn");
          if (chatBox) {
            chatBox.innerHTML = "";
            chatBox.style.display = "none";
          }
          if (nextPhaseBtn) nextPhaseBtn.style.display = "none";
          if (reviewBtn) reviewBtn.style.display = "none";
          updatePanel(newData);
        }
        extractTimer = null;
      }, 1500);
      return;
    }

    if (extractTimer) return;
    extractTimer = setTimeout(() => {
      tryExtract();
      extractTimer = null;
    }, 500);
  });

  observer.observe(document.body, { childList: true, subtree: false });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
