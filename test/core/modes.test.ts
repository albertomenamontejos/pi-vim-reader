import { test } from "node:test";
import assert from "node:assert/strict";
import { createReader, setLines } from "../../src/core/index.ts";
import { make, press, typeKeys } from "./helpers.ts";

const lines = ["one two", "three", "", "four two"];

test("S6: in search mode motion and close keys are typed into the query, not executed", () => {
	const r = press(make(lines), "/", "j", "q", "G", "space");
	assert.equal(r.state.mode, "search");
	assert.equal(r.state.searchInput, "jqG ");
	assert.deepEqual(r.state.cursor, { row: 0, col: 0 });
	assert.deepEqual(r.effects, []);
});

test("S6: backspace on empty search input cancels; escape in search never closes", () => {
	const r = press(make(lines), "/", "backspace");
	assert.equal(r.state.mode, "normal");
	const esc = press(make(lines), "/", "escape");
	assert.equal(esc.state.mode, "normal");
	assert.deepEqual(esc.effects, []);
});

test("S6: enter on an empty query repeats the previous search", () => {
	const first = press(make(lines), "/", ...typeKeys("two"), "enter").state;
	assert.deepEqual(first.cursor, { row: 0, col: 4 });
	assert.deepEqual(press(first, "/", "enter").state.cursor, { row: 3, col: 5 });
});

test("S6/S7: searching from visual mode returns to visual and extends the selection", () => {
	const r = press(make(lines), "v", "/", ...typeKeys("thr"), "enter", "y");
	assert.deepEqual(r.effects, [{ type: "copy", text: "one two\nt" }]);
});

test("S7: escape in visual leaves visual without close; q in visual closes the reader", () => {
	const esc = press(make(lines), "v", "escape");
	assert.equal(esc.state.mode, "normal");
	assert.deepEqual(esc.effects, []);
	for (const keys of [["v", "q"], ["V", "q"]]) assert.deepEqual(press(make(lines), ...keys).effects, [{ type: "close" }]);
});

test("S7: unknown key after y clears the pending operator without copying", () => {
	const r = press(make(lines), "y", "z", "y");
	assert.deepEqual(r.effects, []);
	assert.equal(r.state.pending, "y");
});

test("S4 model: moving back onto the last line re-attaches follow", () => {
	const s = createReader(["a", "b", "c"], { height: 5 });
	const back = press(s, "k", "j").state;
	assert.equal(back.following, true);
	const grown = setLines(back, ["a", "b", "c", "d"]);
	assert.deepEqual(grown.cursor, { row: 3, col: 0 });
});

test("S5: ]] inside the last message goes to the last line", () => {
	const s = make(["u", "a", "a2", "a3"], { meta: [0, 1, 1, 1], row: 1 });
	assert.deepEqual(press(s, "]", "]").state.cursor, { row: 3, col: 0 });
});

test("S8: gx and gf on an empty line report messages", () => {
	assert.deepEqual(press(make([""]), "g", "x").effects, [{ type: "message", text: "No URL under cursor" }]);
	assert.deepEqual(press(make([""]), "g", "f").effects, [{ type: "message", text: "No file under cursor" }]);
});

test("S1: copy effects never alter the buffer", () => {
	const s = make(["```", "code", "```"], { row: 1 });
	const r = press(s, "y", "c", "y", "y", "V", "y");
	assert.deepEqual(r.state.lines, ["```", "code", "```"]);
	assert.equal(r.effects.length, 3);
});
