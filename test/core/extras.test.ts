import { test } from "node:test";
import assert from "node:assert/strict";
import { make, press } from "./helpers.ts";

const doc = ["intro", "```ts", "const a = 1;", "", "const b = 2;", "```", "after", "~~~", "x", "~~~"];

test("S8: yc copies fenced code block content without fences (cursor inside or on a fence)", () => {
	assert.deepEqual(press(make(doc, { row: 2 }), "y", "c").effects, [
		{ type: "copy", text: "const a = 1;\n\nconst b = 2;" },
	]);
	assert.deepEqual(press(make(doc, { row: 5 }), "y", "c").effects, [
		{ type: "copy", text: "const a = 1;\n\nconst b = 2;" },
	]);
	assert.deepEqual(press(make(doc, { row: 8 }), "y", "c").effects, [{ type: "copy", text: "x" }]);
});

test("S8: yc outside a code block reports a message", () => {
	assert.deepEqual(press(make(doc, { row: 6 }), "y", "c").effects, [{ type: "message", text: "No code block" }]);
	assert.deepEqual(press(make(doc, { row: 0 }), "y", "c").effects, [{ type: "message", text: "No code block" }]);
});

test("S8: yc on an unclosed fence copies to end of buffer", () => {
	assert.deepEqual(press(make(["a", "```", "b", "c"], { row: 2 }), "y", "c").effects, [{ type: "copy", text: "b\nc" }]);
});

test("S8: gx opens the http(s) URL under the cursor, stripping trailing punctuation", () => {
	const line = "see (https://example.com/a_b?x=1), or http://foo.dev/path.";
	assert.deepEqual(press(make([line], { col: 10 }), "g", "x").effects, [
		{ type: "open-url", url: "https://example.com/a_b?x=1" },
	]);
	assert.deepEqual(press(make([line], { col: 45 }), "g", "x").effects, [{ type: "open-url", url: "http://foo.dev/path" }]);
	assert.deepEqual(press(make(["[docs](https://x.io/a_(b))"], { col: 10 }), "g", "x").effects, [
		{ type: "open-url", url: "https://x.io/a_(b)" },
	]);
});

test("S8: gx with no URL under cursor reports a message", () => {
	const line = "see https://example.com here";
	assert.deepEqual(press(make([line], { col: 0 }), "g", "x").effects, [
		{ type: "message", text: "No URL under cursor" },
	]);
});

test("S8: gf opens path-like token under cursor, with optional :line", () => {
	assert.deepEqual(press(make(["edit `src/core/reader.ts:42:7` now"], { col: 10 }), "g", "f").effects, [
		{ type: "open-file", path: "src/core/reader.ts", line: 42 },
	]);
	assert.deepEqual(press(make(["open ~/notes/todo.md."], { col: 8 }), "g", "f").effects, [
		{ type: "open-file", path: "~/notes/todo.md" },
	]);
	assert.deepEqual(press(make(["see package.json"], { col: 6 }), "g", "f").effects, [
		{ type: "open-file", path: "package.json" },
	]);
});

test("S8: gf on non-path text or a URL reports a message", () => {
	assert.deepEqual(press(make(["hello world"], { col: 1 }), "g", "f").effects, [
		{ type: "message", text: "No file under cursor" },
	]);
	assert.deepEqual(press(make(["https://a.com/x.ts"], { col: 3 }), "g", "f").effects, [
		{ type: "message", text: "No file under cursor" },
	]);
});

test("S8/S3: q closes; escape in normal mode does nothing (a double Esc must not abort the agent); escape with pending key only clears it", () => {
	assert.deepEqual(press(make(["a"]), "q").effects, [{ type: "close" }]);
	const esc = press(make(["a"]), "escape", "escape");
	assert.deepEqual(esc.effects, []);
	assert.equal(esc.state.mode, "normal");
	const pending = press(make(["a"]), "g", "escape");
	assert.deepEqual(pending.effects, []);
	assert.equal(pending.state.pending, "");
});

test("S3/S8: escape clears every pending prefix without effects and never closes", () => {
	for (const prefix of ["g", "]", "[", "y"]) {
		const r = press(make(["a", "b"]), prefix, "escape");
		assert.deepEqual(r.effects, []);
		assert.equal(r.state.pending, "");
		assert.equal(r.state.mode, "normal");
	}
});

test("S13 core: ctrl+o in normal mode asks to toggle the block under the cursor; elsewhere it does nothing", () => {
	const normal = press(make(["a", "b", "c"], { row: 1 }), "ctrl+o");
	assert.deepEqual(normal.effects, [{ type: "toggle-expand", row: 1 }]);
	assert.equal(normal.state.cursor.row, 1);
	assert.deepEqual(press(make(["a", "b"]), "v", "ctrl+o").effects, []);
	assert.deepEqual(press(make(["a", "b"]), "g", "ctrl+o").effects, []);
});
