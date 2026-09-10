import React, { useState, useEffect, useRef, useCallback } from "react";

/* ---------------------------------------------------------------
   Spar — an AI co-founder that pushes back.
   Six stages, one persistent thread per idea, real artifacts.
--------------------------------------------------------------- */

const PERSONA = `You are Spar, an AI co-founder for a solo builder shipping an idea from 0 to 1.
Voice: direct, sharp, skeptical but constructive. Never a yes-man, never mean.
Ask pointed follow-up questions before agreeing anything is good. Push back on vague
answers ("everyone", "nice to have", "just an MVP of everything"). Keep replies short —
2 to 5 sentences, conversational prose, no bullet lists unless the founder asks for one.
Never close with generic filler like "let me know if you need anything else."`;

const STAGE_ORDER = [
  "ideation",
  "validation",
  "scoping",
  "building",
  "launch",
  "iteration",
];

const STAGES = {
  ideation: {
    tag: "01",
    label: "Ideation",
    greeting: "What are you building, and who is this failing to serve right now?",
    system: `${PERSONA}

Current stage: IDEATION. Your job: pressure-test the founder's idea until it narrows
into one sharp sentence — who it's for, what painful problem it solves, and why now.
Don't let them move on until you both agree on a one-liner they'd be embarrassed to
say out loud if it were vague.`,
    artifactLabel: "One-liner",
    artifactPrompt: `Based on the conversation above, output ONLY the final one-liner idea
statement, in the form: "A [thing] for [specific user] to [solve specific painful
problem], because [why now]." Output just that sentence, nothing else.`,
  },
  validation: {
    tag: "02",
    label: "Validation",
    greeting: "Let's prove this before you build anything. Who would you show it to first, and how would they react?",
    system: `${PERSONA}

Current stage: VALIDATION. Your job: help the founder test demand before writing code.
Suggest the cheapest possible test given their idea and audience — a landing page, a
DM to ten real prospects, a survey — and help them read the result honestly. Don't let
a few polite "sounds cool!" replies count as validation.`,
    artifactLabel: "Validation brief",
    artifactPrompt: `Based on the conversation above, write a short validation brief in
plain text, under 120 words, covering: (1) the cheapest test to run this week, (2) the
exact outreach message or landing page headline+subhead to use, (3) what result would
count as real signal versus a false positive.`,
  },
  scoping: {
    tag: "03",
    label: "Scoping",
    greeting: "Tell me everything you think this needs to do. I'll tell you what to cut.",
    system: `${PERSONA}

Current stage: SCOPING. Your job: cut the idea down to the smallest version worth
building. Challenge every feature that isn't essential to prove the core value. Assume
the founder wants to overbuild — your job is to say no to most of it, out loud.`,
    artifactLabel: "MVP scope",
    artifactPrompt: `Based on the conversation above, output an MVP scope as two short
plain-text lists, each 3 to 5 items: "BUILD" (the minimum that proves the idea) and
"CUT FOR NOW" (things they wanted but shouldn't build yet).`,
  },
  building: {
    tag: "04",
    label: "Building",
    greeting: "What's the scope we're building from? I'll help turn it into an actual plan.",
    system: `${PERSONA}

Current stage: BUILDING. Your job: turn the scoped MVP into a concrete, realistic build
plan for a solo builder — a simple tech stack with one-line reasoning, and the core
screens or endpoints needed. Bias toward shipping fast over engineering elegance.`,
    artifactLabel: "Build plan",
    artifactPrompt: `Based on the conversation above and the MVP scope, output a short
build plan under 150 words: a recommended stack with one-line reasoning, then a short
bullet list of the core screens or components needed.`,
  },
  launch: {
    tag: "05",
    label: "Launch",
    greeting: "Who are your first 10 users, and how are you actually going to reach them?",
    system: `${PERSONA}

Current stage: LAUNCH. Your job: help the founder get the MVP in front of first users —
draft the landing headline/subhead, a short onboarding welcome message, and a first
outreach post. Keep it plain and specific, not salesy.`,
    artifactLabel: "Launch draft",
    artifactPrompt: `Based on the conversation above, write, clearly labeled, under 150
words total: a landing headline + subhead, a one-line onboarding welcome message, and a
short first-post draft for X/Twitter or a founder community.`,
  },
  iteration: {
    tag: "06",
    label: "Iteration",
    greeting: "What have your first real users said or done so far?",
    system: `${PERSONA}

Current stage: ITERATION. Your job: help the founder decide what to act on now that
real users are using the MVP. Ask what feedback or usage patterns they're seeing, then
help sort signal from noise.`,
    artifactLabel: "Feedback triage",
    artifactPrompt: `Based on the conversation above, sort what's been mentioned into
three short plain-text lists: "FIX NOW", "WATCH", and "IGNORE FOR NOW", each item with
a one-line reason.`,
  },
};

function newId() {
  return "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function freshSession(name) {
  const stages = {};
  STAGE_ORDER.forEach((key) => {
    stages[key] = {
      messages: [{ role: "assistant", content: STAGES[key].greeting }],
      artifact: null,
    };
  });
  return {
    id: newId(),
    name: name || "Untitled idea",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stages,
  };
}

async function callClaude(system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error("Spar couldn't respond (" + res.status + ")");
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

function buildContextPrefix(session, currentKey) {
  const idx = STAGE_ORDER.indexOf(currentKey);
  const known = [];
  STAGE_ORDER.slice(0, idx).forEach((key) => {
    const artifact = session.stages[key]?.artifact;
    if (artifact) {
      known.push(`${STAGES[key].label.toUpperCase()} — ${STAGES[key].artifactLabel}:\n${artifact}`);
    }
  });
  if (known.length === 0) return "";
  return `\n\nKnown so far from earlier stages (treat as settled unless the founder\ncontradicts it):\n${known.join("\n\n")}`;
}

export default function SparApp() {
  const [index, setIndex] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [session, setSession] = useState(null);
  const [stageKey, setStageKey] = useState("ideation");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const scrollRef = useRef(null);
  const storageOk = typeof window !== "undefined" && window.storage;

  // load font + index on mount
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@400;500&display=swap";
    document.head.appendChild(link);

    (async () => {
      try {
        const result = await window.storage.get("sessions-index");
        const list = result ? JSON.parse(result.value) : [];
        setIndex(list);
        if (list.length > 0) {
          loadSession(list[0].id);
        }
      } catch (e) {
        setIndex([]);
      }
    })();

    return () => {
      document.head.removeChild(link);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session, stageKey]);

  async function saveIndex(list) {
    setIndex(list);
    try {
      await window.storage.set("sessions-index", JSON.stringify(list));
    } catch (e) {
      setErrorMsg("Couldn't save your session list.");
    }
  }

  async function saveSession(s) {
    setSession(s);
    try {
      await window.storage.set("session:" + s.id, JSON.stringify(s));
    } catch (e) {
      setErrorMsg("Couldn't save this idea. Your last message may not persist.");
    }
  }

  async function loadSession(id) {
    setErrorMsg("");
    try {
      const result = await window.storage.get("session:" + id);
      if (result) {
        const s = JSON.parse(result.value);
        setSession(s);
        setActiveId(id);
        setStageKey("ideation");
      }
    } catch (e) {
      setErrorMsg("Couldn't load that idea.");
    }
  }

  async function createSession() {
    const name = newName.trim() || "Untitled idea";
    const s = freshSession(name);
    const entry = { id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt };
    const list = [entry, ...index];
    await saveIndex(list);
    await saveSession(s);
    setActiveId(s.id);
    setStageKey("ideation");
    setNewName("");
    setCreating(false);
  }

  async function deleteSession(id, e) {
    e.stopPropagation();
    const list = index.filter((i) => i.id !== id);
    await saveIndex(list);
    try {
      await window.storage.delete("session:" + id);
    } catch (err) {
      /* ignore */
    }
    if (activeId === id) {
      setSession(null);
      setActiveId(null);
      if (list.length > 0) loadSession(list[0].id);
    }
  }

  async function renameSession() {
    const name = nameDraft.trim() || session.name;
    const updated = { ...session, name, updatedAt: Date.now() };
    await saveSession(updated);
    const list = index.map((i) => (i.id === session.id ? { ...i, name, updatedAt: updated.updatedAt } : i));
    await saveIndex(list);
    setEditingName(false);
  }

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !session || sending) return;
    setErrorMsg("");
    setInput("");
    setSending(true);

    const stage = session.stages[stageKey];
    const nextMessages = [...stage.messages, { role: "user", content: text }];
    const optimistic = {
      ...session,
      updatedAt: Date.now(),
      stages: { ...session.stages, [stageKey]: { ...stage, messages: nextMessages } },
    };
    setSession(optimistic);

    try {
      const system = STAGES[stageKey].system + buildContextPrefix(session, stageKey);
      const reply = await callClaude(
        system,
        nextMessages.map((m) => ({ role: m.role, content: m.content }))
      );
      const withReply = {
        ...optimistic,
        stages: {
          ...optimistic.stages,
          [stageKey]: {
            ...optimistic.stages[stageKey],
            messages: [...nextMessages, { role: "assistant", content: reply }],
          },
        },
      };
      await saveSession(withReply);
      const list = index.map((i) =>
        i.id === session.id ? { ...i, updatedAt: withReply.updatedAt } : i
      );
      await saveIndex(list);
    } catch (e) {
      setErrorMsg(e.message || "Something went wrong talking to Spar.");
      await saveSession(optimistic);
    } finally {
      setSending(false);
    }
  }, [input, session, stageKey, sending, index]);

  async function generateArtifact() {
    if (!session || generating) return;
    setErrorMsg("");
    setGenerating(true);
    const stage = session.stages[stageKey];
    try {
      const system = STAGES[stageKey].system + buildContextPrefix(session, stageKey);
      const messages = [
        ...stage.messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: STAGES[stageKey].artifactPrompt },
      ];
      const reply = await callClaude(system, messages);
      const updated = {
        ...session,
        updatedAt: Date.now(),
        stages: {
          ...session.stages,
          [stageKey]: { ...stage, artifact: reply.trim() },
        },
      };
      await saveSession(updated);
      const list = index.map((i) =>
        i.id === session.id ? { ...i, updatedAt: updated.updatedAt } : i
      );
      await saveIndex(list);
    } catch (e) {
      setErrorMsg(e.message || "Couldn't generate that right now.");
    } finally {
      setGenerating(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const activeStage = STAGES[stageKey];
  const stageData = session ? session.stages[stageKey] : null;

  return (
    <div style={styles.app}>
      <style>{css}</style>

      {/* sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.wordmark}>
          Spar<span style={{ color: "var(--stamp)" }}>.</span>
        </div>

        {!creating ? (
          <button style={styles.newBtn} onClick={() => setCreating(true)}>
            + New idea
          </button>
        ) : (
          <div style={styles.newForm}>
            <input
              autoFocus
              className="mono"
              style={styles.newInput}
              placeholder="Name this idea..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createSession()}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button style={styles.smallBtn} onClick={createSession}>
                Create
              </button>
              <button
                style={{ ...styles.smallBtn, background: "transparent", color: "var(--ink-soft)" }}
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={styles.sessionList}>
          {index.length === 0 && !storageOk && (
            <div style={styles.emptyNote}>Storage isn't available in this preview.</div>
          )}
          {index
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s.id)}
                style={{
                  ...styles.sessionItem,
                  ...(activeId === s.id ? styles.sessionItemActive : {}),
                }}
              >
                <span style={styles.sessionName}>{s.name}</span>
                <span style={styles.deleteX} onClick={(e) => deleteSession(s.id, e)}>
                  ×
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* main */}
      <div style={styles.main}>
        {!session ? (
          <div style={styles.welcome}>
            <div className="mono" style={styles.fileNo}>
              CASE FILE — CLOSED
            </div>
            <h2 style={styles.welcomeH2}>No idea open yet.</h2>
            <p style={styles.welcomeP}>
              Start one on the left. Spar will ask the first honest question.
            </p>
          </div>
        ) : (
          <>
            <div style={styles.header}>
              {editingName ? (
                <input
                  autoFocus
                  className="mono"
                  style={styles.nameInput}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={renameSession}
                  onKeyDown={(e) => e.key === "Enter" && renameSession()}
                />
              ) : (
                <h2
                  style={styles.title}
                  onClick={() => {
                    setNameDraft(session.name);
                    setEditingName(true);
                  }}
                  title="Click to rename"
                >
                  {session.name}
                </h2>
              )}

              <div style={styles.stageStepper}>
                {STAGE_ORDER.map((key) => {
                  const done = !!session.stages[key].artifact;
                  const active = key === stageKey;
                  return (
                    <div
                      key={key}
                      onClick={() => setStageKey(key)}
                      className="mono"
                      style={{
                        ...styles.stageTab,
                        ...(active ? styles.stageTabActive : {}),
                      }}
                    >
                      {done && <span style={styles.dot}>●</span>}
                      {STAGES[key].tag} {STAGES[key].label}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={styles.body}>
              <div style={styles.chatCol}>
                <div ref={scrollRef} style={styles.messages}>
                  {stageData.messages.map((m, i) => (
                    <div key={i} style={styles.msgRow}>
                      <span
                        className="mono"
                        style={{
                          ...styles.who,
                          color: m.role === "assistant" ? "var(--pen)" : "var(--ink-soft)",
                        }}
                      >
                        {m.role === "assistant" ? "SPAR" : "YOU"}
                      </span>
                      <div style={styles.msgText}>{m.content}</div>
                    </div>
                  ))}
                  {sending && (
                    <div style={styles.msgRow}>
                      <span className="mono" style={{ ...styles.who, color: "var(--pen)" }}>
                        SPAR
                      </span>
                      <div style={{ ...styles.msgText, color: "var(--ink-soft)", fontStyle: "italic" }}>
                        thinking…
                      </div>
                    </div>
                  )}
                </div>

                {errorMsg && <div style={styles.error}>{errorMsg}</div>}

                <div style={styles.inputRow}>
                  <textarea
                    style={styles.textarea}
                    placeholder="Type your reply. Enter to send, shift+Enter for a new line."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={2}
                  />
                  <button style={styles.sendBtn} onClick={sendMessage} disabled={sending}>
                    Send
                  </button>
                </div>
              </div>

              <div style={styles.artifactCol}>
                <div className="mono" style={styles.artifactLabel}>
                  {activeStage.artifactLabel.toUpperCase()}
                </div>
                <div style={styles.artifactBox}>
                  {stageData.artifact ? (
                    <div style={styles.artifactText}>{stageData.artifact}</div>
                  ) : (
                    <div style={styles.artifactPlaceholder}>
                      Nothing generated yet. Talk it through with Spar, then generate this
                      stage's deliverable.
                    </div>
                  )}
                </div>
                <button style={styles.genBtn} onClick={generateArtifact} disabled={generating}>
                  {generating
                    ? "Working…"
                    : stageData.artifact
                    ? "Regenerate deliverable"
                    : "Generate deliverable"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const css = `
  :root{
    --paper: #EAE7DD;
    --paper-dark: #DDD7C6;
    --ink: #1E2027;
    --ink-soft: #55575F;
    --stamp: #A93226;
    --pen: #2F6F62;
    --rule: #C7BFA9;
  }
  .mono{ font-family:'IBM Plex Mono', monospace; }
  ::placeholder{ color:#8A8C7F; }
  *{ box-sizing:border-box; }
`;

const styles = {
  app: {
    display: "flex",
    height: "100%",
    minHeight: "640px",
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "'IBM Plex Serif', serif",
  },
  sidebar: {
    width: 240,
    minWidth: 240,
    borderRight: "1px solid var(--rule)",
    padding: "20px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  wordmark: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
  },
  newBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    background: "var(--ink)",
    color: "var(--paper)",
    border: "none",
    padding: "10px 12px",
    cursor: "pointer",
  },
  newForm: { display: "flex", flexDirection: "column" },
  newInput: {
    fontSize: 13,
    padding: "8px 10px",
    border: "1px solid var(--ink)",
    background: "transparent",
    color: "var(--ink)",
  },
  smallBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    background: "var(--ink)",
    color: "var(--paper)",
    border: "none",
    padding: "6px 10px",
    cursor: "pointer",
  },
  sessionList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginTop: 6,
    overflowY: "auto",
  },
  sessionItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "9px 10px",
    fontSize: 14,
    cursor: "pointer",
    color: "var(--ink-soft)",
    borderLeft: "2px solid transparent",
  },
  sessionItemActive: {
    background: "var(--paper-dark)",
    color: "var(--ink)",
    borderLeft: "2px solid var(--stamp)",
  },
  sessionName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deleteX: {
    fontFamily: "'IBM Plex Mono', monospace",
    color: "var(--ink-soft)",
    padding: "0 4px",
  },
  emptyNote: { fontSize: 12, color: "var(--ink-soft)" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  welcome: {
    margin: "auto",
    maxWidth: 360,
    textAlign: "left",
  },
  fileNo: { fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 },
  welcomeH2: { fontFamily: "'Fraunces', serif", fontSize: 26, margin: 0 },
  welcomeP: { color: "var(--ink-soft)", marginTop: 10, fontSize: 15 },
  header: {
    padding: "20px 24px 0",
    borderBottom: "1px solid var(--rule)",
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontSize: 22,
    margin: "0 0 16px",
    cursor: "text",
    display: "inline-block",
  },
  nameInput: {
    fontSize: 18,
    padding: "4px 6px",
    border: "1px solid var(--ink)",
    background: "transparent",
    marginBottom: 16,
    display: "block",
  },
  stageStepper: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
    marginBottom: 0,
  },
  stageTab: {
    fontSize: 12,
    padding: "8px 10px",
    color: "var(--ink-soft)",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
  },
  stageTabActive: {
    color: "var(--ink)",
    borderBottom: "2px solid var(--stamp)",
  },
  dot: { color: "var(--pen)", marginRight: 4, fontSize: 8 },
  body: { flex: 1, display: "flex", minHeight: 0 },
  chatCol: {
    flex: 1.3,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--rule)",
    minWidth: 0,
  },
  messages: { flex: 1, overflowY: "auto", padding: "20px 24px" },
  msgRow: { marginBottom: 16 },
  who: { fontSize: 11, display: "block", marginBottom: 3 },
  msgText: { fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap" },
  error: {
    margin: "0 24px 10px",
    color: "var(--stamp)",
    fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: "12px 24px 20px",
    borderTop: "1px solid var(--rule)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "1px solid var(--ink)",
    background: "transparent",
    padding: "10px 12px",
    fontFamily: "'IBM Plex Serif', serif",
    fontSize: 14,
    color: "var(--ink)",
  },
  sendBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    background: "var(--ink)",
    color: "var(--paper)",
    border: "none",
    padding: "0 18px",
    cursor: "pointer",
  },
  artifactCol: {
    flex: 1,
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    background: "var(--paper-dark)",
    minWidth: 260,
  },
  artifactLabel: { fontSize: 11, color: "var(--ink-soft)", marginBottom: 12 },
  artifactBox: { flex: 1, overflowY: "auto", marginBottom: 14 },
  artifactText: { fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" },
  artifactPlaceholder: { fontSize: 13, color: "var(--ink-soft)", fontStyle: "italic" },
  genBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    background: "transparent",
    color: "var(--ink)",
    border: "1px solid var(--ink)",
    padding: "10px 12px",
    cursor: "pointer",
  },
};
