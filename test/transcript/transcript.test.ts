import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscript } from "../../src/transcript/transcript.ts";

const W = 80;
const msg = (message: unknown, id = "e") => ({ type: "message", id, parentId: null, timestamp: "t", message });
const user = (content: unknown, timestamp = 1) => ({ role: "user", content, timestamp });
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  role: "assistant",
  content,
  stopReason: "stop",
  timestamp: 100,
  ...extra,
});
const toolResult = (text: string, isError = false, toolName = "bash") => ({
  role: "toolResult",
  toolCallId: "c1",
  toolName,
  content: [{ type: "text", text }],
  isError,
  timestamp: 200,
});

test("user message: header, string content, blank separator", () => {
  const { lines } = buildTranscript([msg(user("hello world"))], { width: W });
  assert.deepEqual(lines, ["── You ──", "hello world", ""]);
});

test("user message: text parts and images as [image]", () => {
  const { lines } = buildTranscript(
    [msg(user([{ type: "text", text: "look" }, { type: "image", data: "xx", mimeType: "image/png" }]))],
    { width: W },
  );
  assert.deepEqual(lines, ["── You ──", "look", "[image]", ""]);
});

test("assistant: text verbatim incl. fences, thinking omitted", () => {
  const text = "Here:\n```ts\nconst a = 1;\n```\ndone";
  const { lines } = buildTranscript(
    [msg(assistant([{ type: "thinking", thinking: "secret plan" }, { type: "text", text }]))],
    { width: W },
  );
  assert.deepEqual(lines, ["── Assistant ──", "Here:", "```ts", "const a = 1;", "```", "done", ""]);
  assert.ok(!lines.join("\n").includes("secret plan"));
});

test("assistant: toolCall rendered as one arrow line with compact JSON args", () => {
  const { lines } = buildTranscript(
    [msg(assistant([{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts", limit: 5 } }]))],
    { width: W },
  );
  assert.deepEqual(lines, ["── Assistant ──", '→ read({"path":"a.ts","limit":5})', ""]);
});

test("assistant: toolCall args truncated to 200 chars", () => {
  const { lines } = buildTranscript(
    [msg(assistant([{ type: "toolCall", id: "c1", name: "write", arguments: { content: "x".repeat(500) } }]))],
    { width: 1000 },
  );
  assert.equal(lines.length, 3);
  const call = lines[1];
  assert.ok(call.startsWith('→ write({"content":"xxx'));
  assert.ok(call.endsWith("…)"));
  assert.equal(call.length, "→ write(".length + 200 + "…)".length);
});

test("toolResult: header with tool name and text body", () => {
  const { lines } = buildTranscript([msg(toolResult("ok\nfine"))], { width: W });
  assert.deepEqual(lines, ["── Tool: bash ──", "ok", "fine", ""]);
});

test("toolResult: error marked in header", () => {
  const { lines } = buildTranscript([msg(toolResult("boom", true, "edit"))], { width: W });
  assert.deepEqual(lines, ["── Tool: edit (error) ──", "boom", ""]);
});

test("toolResult: truncated to first 40 lines with more-lines marker", () => {
  const body = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
  const { lines } = buildTranscript([msg(toolResult(body))], { width: W });
  assert.equal(lines.length, 1 + 40 + 1 + 1);
  assert.equal(lines[1], "line 1");
  assert.equal(lines[40], "line 40");
  assert.equal(lines[41], "… (10 more lines)");
  assert.equal(lines[42], "");
});

test("toolResult: exactly 40 lines is not truncated", () => {
  const body = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
  const { lines } = buildTranscript([msg(toolResult(body))], { width: W });
  assert.equal(lines.length, 42);
  assert.ok(!lines.some((l) => l.startsWith("…")));
});

test("wrap: soft wrap on spaces", () => {
  const { lines } = buildTranscript([msg(user("aaa bbb ccc ddd"))], { width: 7 });
  assert.deepEqual(lines, ["── You ──", "aaa bbb", "ccc ddd", ""]);
});

test("wrap: long word is hard broken", () => {
  const { lines } = buildTranscript([msg(user("abcdefghij xy"))], { width: 4 });
  assert.deepEqual(lines.slice(1, -1), ["abcd", "efgh", "ij", "xy"]);
  for (const l of lines) assert.ok([...l].length <= 4 || l.startsWith("──"));
});

test("wrap: tabs become 2 spaces, ANSI and control chars stripped", () => {
  const { lines } = buildTranscript([msg(user("\tx\u001b[31mred\u001b[0m\u0007\r"))], { width: W });
  assert.deepEqual(lines, ["── You ──", "  xred", ""]);
});

test("wrap: fence marker line is never split", () => {
  const fence = "```" + "typescript-with-a-very-long-info-string";
  const { lines } = buildTranscript([msg(assistant([{ type: "text", text: `${fence}\ncode\n\`\`\`` }]))], {
    width: 10,
  });
  assert.deepEqual(lines.slice(1, -1), [fence, "code", "```"]);
});

test("meta: each line maps to its message index", () => {
  const { lines, meta } = buildTranscript(
    [msg(user("hi")), msg(assistant([{ type: "text", text: "a\nb" }])), msg(toolResult("r"))],
    { width: W },
  );
  assert.equal(meta.length, lines.length);
  assert.deepEqual(meta, [0, 0, 0, 1, 1, 1, 1, 2, 2, 2]);
});

test("meta: wrapped lines keep their message index", () => {
  const { lines, meta } = buildTranscript([msg(user("x")), msg(user("aaa bbb ccc"))], { width: 3 });
  assert.equal(meta.length, lines.length);
  assert.deepEqual(meta, [0, 0, 0, 1, 1, 1, 1, 1]);
});

test("streaming: partial assistant appended as last message", () => {
  const partial = assistant([{ type: "text", text: "typing" }], { timestamp: 500, stopReason: "pending" });
  const { lines, meta } = buildTranscript([msg(user("q"))], { width: W, streaming: partial as never });
  assert.deepEqual(lines, ["── You ──", "q", "", "── Assistant ──", "typing", ""]);
  assert.deepEqual(meta, [0, 0, 0, 1, 1, 1]);
});

test("streaming: not duplicated when last entry is the same message by reference", () => {
  const a = assistant([{ type: "text", text: "done" }], { timestamp: 500 });
  const { lines } = buildTranscript([msg(user("q")), msg(a)], { width: W, streaming: a as never });
  assert.equal(lines.filter((l) => l === "── Assistant ──").length, 1);
});

test("streaming: not duplicated when last entry is assistant with same timestamp", () => {
  const persisted = assistant([{ type: "text", text: "done" }], { timestamp: 500 });
  const partial = assistant([{ type: "text", text: "do" }], { timestamp: 500, stopReason: "pending" });
  const { lines } = buildTranscript([msg(user("q")), msg(persisted)], { width: W, streaming: partial as never });
  assert.deepEqual(lines, ["── You ──", "q", "", "── Assistant ──", "done", ""]);
});

test("streaming: different timestamp is appended", () => {
  const prev = assistant([{ type: "text", text: "one" }], { timestamp: 500 });
  const partial = assistant([{ type: "text", text: "two" }], { timestamp: 600 });
  const { lines } = buildTranscript([msg(prev)], { width: W, streaming: partial as never });
  assert.equal(lines.filter((l) => l === "── Assistant ──").length, 2);
  assert.equal(lines.at(-2), "two");
});

test("custom_message entry with display:true shows text; display:false hidden", () => {
  const { lines } = buildTranscript(
    [
      { type: "custom_message", id: "c", customType: "note", content: "visible", display: true },
      { type: "custom_message", id: "d", customType: "note", content: "hidden", display: false },
    ],
    { width: W },
  );
  assert.deepEqual(lines, ["── note ──", "visible", ""]);
});

test("message with role custom and display:true is shown under its customType", () => {
  const { lines } = buildTranscript(
    [
      msg({ role: "custom", customType: "reminder", content: [{ type: "text", text: "hey" }], display: true, timestamp: 1 }),
      msg({ role: "custom", customType: "reminder", content: "no", display: false, timestamp: 2 }),
    ],
    { width: W },
  );
  assert.deepEqual(lines, ["── reminder ──", "hey", ""]);
});

test("unknown entries and malformed shapes are skipped without throwing", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const entries: unknown[] = [
    null,
    undefined,
    42,
    "str",
    { type: "model_change", provider: "p", modelId: "m" },
    { type: "message" },
    { type: "message", message: null },
    { type: "message", message: { role: "system", content: "sys" } },
    { type: "message", message: { role: "weird" } },
    { type: "message", message: { role: "assistant", content: "not-array" } },
    { type: "message", message: { role: "assistant", content: [null, { type: "toolCall", name: "x", arguments: circular }] } },
    msg(user("kept")),
  ];
  let out!: ReturnType<typeof buildTranscript>;
  assert.doesNotThrow(() => {
    out = buildTranscript(entries, { width: W });
  });
  assert.ok(out.lines.includes("kept"));
  assert.ok(!out.lines.includes("sys"));
  assert.equal(out.meta.length, out.lines.length);
  assert.doesNotThrow(() => buildTranscript(null as never, { width: W }));
});

test("S17 transcript: user flag per block is true only for user messages", () => {
  const t = buildTranscript(
    [msg(user("hi")), msg(assistant([{ type: "text", text: "yo" }])), msg(user("again"), "e2")],
    { width: W },
  );
  assert.deepEqual(t.user, [true, false, true]);
});
