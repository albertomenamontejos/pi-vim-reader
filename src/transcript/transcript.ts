/**
 * Pure transcript builder: turns Pi session entries into plain-text, width-wrapped
 * lines for the read-only vim reader. No runtime Pi imports; every input is treated
 * as `unknown` and validated structurally, so unknown or malformed shapes are
 * skipped and this module never throws.
 *
 * Shapes relied on (Pi 1.5.2):
 * - SessionMessageEntry `{ type: "message"; message: AgentMessage }`
 *   (pi-coding-agent dist/core/session-manager.d.ts:23)
 * - CustomMessageEntry `{ type: "custom_message"; customType; content; display }`
 *   (pi-coding-agent dist/core/session-manager.d.ts:109; union at :128)
 * - CustomMessage `{ role: "custom"; customType; content; display }`
 *   (pi-coding-agent dist/core/messages.d.ts:32)
 * - UserMessage `content: string | (TextContent | ImageContent)[]` (pi-ai dist/types.d.ts:377)
 * - AssistantMessage `content: (TextContent | ThinkingContent | ToolCall)[]`, `timestamp: number`
 *   = request start (pi-ai dist/types.d.ts:382, :406)
 * - ToolResultMessage `{ toolName; content: (TextContent | ImageContent)[]; isError }`
 *   (pi-ai dist/types.d.ts:434)
 * - TextContent / ThinkingContent / ImageContent / ToolCall {name, arguments}
 *   (pi-ai dist/types.d.ts:259, :264, :273, :278)
 */

export interface TranscriptOptions {
  /** Wrap width in columns (code points). Values < 1 or non-finite fall back to 80. */
  width: number;
  /** Partial assistant message from `message_update`, appended as the last message. */
  streaming?: unknown;
}

export interface Transcript {
  lines: string[];
  /** `meta[i]` is the 0-based index of the rendered message that line `i` belongs to. */
  meta: number[];
}

export const TOOL_RESULT_MAX_LINES = 40;
export const TOOL_ARGS_MAX_CHARS = 200;

type Rec = Record<string, unknown>;

interface Block {
  header: string;
  body: string[];
}

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const header = (label: string): string => `── ${label} ──`;

// CSI, OSC (BEL or ST terminated), and other two-char ESC sequences.
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// C0 controls except \n, plus DEL and C1 controls.
const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

function sanitize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, "  ").replace(ANSI_RE, "").replace(CONTROL_RE, "");
}

function splitLines(text: string): string[] {
  return sanitize(text).split("\n");
}

const isFenceLine = (line: string): boolean => /^\s*(```|~~~)/.test(line);

/** Soft wrap on spaces, hard break words longer than `width`. Fence marker lines are kept whole. */
export function wrapLine(line: string, width: number): string[] {
  let chars = Array.from(line);
  if (chars.length <= width || isFenceLine(line)) return [line];
  const out: string[] = [];
  while (chars.length > width) {
    let brk = -1;
    for (let i = width; i > 0; i--) {
      if (chars[i] === " ") {
        brk = i;
        break;
      }
    }
    if (brk > 0) {
      out.push(chars.slice(0, brk).join("").trimEnd());
      chars = chars.slice(brk + 1);
    } else {
      out.push(chars.slice(0, width).join(""));
      chars = chars.slice(width);
    }
  }
  out.push(chars.join(""));
  return out;
}

function partsText(content: unknown, allowImages: boolean): string[] {
  if (typeof content === "string") return splitLines(content);
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (!isRec(part)) continue;
    if (part.type === "text" && typeof part.text === "string") out.push(...splitLines(part.text));
    else if (allowImages && part.type === "image") out.push("[image]");
  }
  return out;
}

function compactArgs(args: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(args ?? {}) ?? "";
  } catch {
    json = "…";
  }
  json = sanitize(json).replace(/\n/g, " ");
  const chars = Array.from(json);
  return chars.length > TOOL_ARGS_MAX_CHARS ? chars.slice(0, TOOL_ARGS_MAX_CHARS).join("") + "…" : json;
}

function assistantBlock(m: Rec): Block {
  const body: string[] = [];
  if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (!isRec(part)) continue;
      if (part.type === "text" && typeof part.text === "string") body.push(...splitLines(part.text));
      else if (part.type === "toolCall") {
        const name = typeof part.name === "string" ? sanitize(part.name) : "?";
        body.push(`→ ${name}(${compactArgs(part.arguments)})`);
      }
      // thinking parts are intentionally omitted
    }
  }
  if (typeof m.errorMessage === "string" && m.errorMessage) body.push(...splitLines(`[error] ${m.errorMessage}`));
  return { header: header("Assistant"), body };
}

function toolResultBlock(m: Rec): Block {
  const name = typeof m.toolName === "string" ? sanitize(m.toolName) : "?";
  let body = partsText(m.content, true);
  if (body.length > TOOL_RESULT_MAX_LINES) {
    const more = body.length - TOOL_RESULT_MAX_LINES;
    body = [...body.slice(0, TOOL_RESULT_MAX_LINES), `… (${more} more lines)`];
  }
  return { header: header(`Tool: ${name}${m.isError === true ? " (error)" : ""}`), body };
}

function customBlock(c: Rec): Block | undefined {
  if (c.display !== true) return undefined;
  const body = partsText(c.content, true);
  if (body.length === 0) return undefined;
  const label = typeof c.customType === "string" && c.customType ? sanitize(c.customType) : "Custom";
  return { header: header(label), body };
}

function messageBlock(m: unknown): Block | undefined {
  if (!isRec(m)) return undefined;
  switch (m.role) {
    case "user":
      return { header: header("You"), body: partsText(m.content, true) };
    case "assistant":
      return assistantBlock(m);
    case "toolResult":
      return toolResultBlock(m);
    case "custom":
      return customBlock(m);
    default:
      return undefined; // system, bashExecution, summaries, unknown roles
  }
}

/**
 * Streaming de-dup rule: the streaming message is skipped when the last rendered
 * message is the same object (reference) or is an assistant message with the same
 * numeric `timestamp` (AssistantMessage.timestamp = request start, stable across
 * `message_update` events and the persisted entry).
 */
function sameMessage(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return (
    isRec(a) &&
    isRec(b) &&
    a.role === "assistant" &&
    b.role === "assistant" &&
    typeof a.timestamp === "number" &&
    a.timestamp === b.timestamp
  );
}

export function buildTranscript(entries: unknown[], opts: TranscriptOptions): Transcript {
  const rawWidth = isRec(opts) ? Math.floor(Number(opts.width)) : NaN;
  const width = Number.isFinite(rawWidth) && rawWidth >= 1 ? rawWidth : 80;
  const blocks: Block[] = [];
  let lastMessage: unknown = undefined;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRec(entry)) continue;
    let block: Block | undefined;
    if (entry.type === "message") {
      block = messageBlock(entry.message);
      if (block) lastMessage = entry.message;
    } else if (entry.type === "custom_message") {
      block = customBlock(entry);
      if (block) lastMessage = entry;
    }
    if (block) blocks.push(block);
  }

  const streaming = isRec(opts) ? opts.streaming : undefined;
  if (streaming !== undefined && !sameMessage(lastMessage, streaming)) {
    const block = messageBlock(streaming);
    if (block) blocks.push(block);
  }

  const lines: string[] = [];
  const meta: number[] = [];
  blocks.forEach((block, index) => {
    // Headers are never wrapped (the renderer clips them); body lines are.
    lines.push(block.header);
    meta.push(index);
    for (const raw of block.body) {
      for (const line of wrapLine(raw, width)) {
        lines.push(line);
        meta.push(index);
      }
    }
    lines.push("");
    meta.push(index);
  });
  return { lines, meta };
}
