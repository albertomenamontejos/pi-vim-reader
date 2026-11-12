import { test } from "node:test";
import assert from "node:assert/strict";
import { make, press, typeKeys } from "./helpers.ts";

const lines = ["alpha Foo", "beta foo", "gamma", "delta FOO"];

test("S6: / enters search mode, typing and backspace edit the query, escape cancels", () => {
	const s = make(lines, { row: 0 });
	const typing = press(s, "/", ...typeKeys("fox"), "backspace").state;
	assert.equal(typing.mode, "search");
	assert.equal(typing.searchInput, "fo");
	const cancelled = press(typing, "escape").state;
	assert.equal(cancelled.mode, "normal");
	assert.deepEqual(cancelled.cursor, { row: 0, col: 0 });
});

test("S6: enter searches forward, smartcase lowercase query is case-insensitive", () => {
	const s = make(lines, { row: 0 });
	const r = press(s, "/", ...typeKeys("foo"), "enter").state;
	assert.equal(r.mode, "normal");
	assert.deepEqual(r.cursor, { row: 0, col: 6 });
});

test("S6: smartcase query with uppercase is case-sensitive", () => {
	const s = make(lines, { row: 0 });
	const r = press(s, "/", ...typeKeys("FOO"), "enter").state;
	assert.deepEqual(r.cursor, { row: 3, col: 6 });
});

test("S6: n repeats forward and wraps around with a message, N goes the opposite way", () => {
	const s = make(lines, { row: 0 });
	const first = press(s, "/", ...typeKeys("foo"), "enter").state;
	const n1 = press(first, "n").state;
	assert.deepEqual(n1.cursor, { row: 1, col: 5 });
	const n2 = press(n1, "n").state;
	assert.deepEqual(n2.cursor, { row: 3, col: 6 });
	const wrapped = press(n2, "n");
	assert.deepEqual(wrapped.state.cursor, { row: 0, col: 6 });
	assert.deepEqual(wrapped.effects, [{ type: "message", text: "search hit BOTTOM, continuing at TOP" }]);
	const back = press(wrapped.state, "N");
	assert.deepEqual(back.state.cursor, { row: 3, col: 6 });
	assert.deepEqual(back.effects, [{ type: "message", text: "search hit TOP, continuing at BOTTOM" }]);
});

test("S6: ? searches backward and n continues backward", () => {
	const s = make(lines, { row: 2 });
	const r = press(s, "?", ...typeKeys("foo"), "enter").state;
	assert.deepEqual(r.cursor, { row: 1, col: 5 });
	assert.deepEqual(press(r, "n").state.cursor, { row: 0, col: 6 });
	assert.deepEqual(press(r, "N").state.cursor, { row: 3, col: 6 });
});

test("S6: not found leaves cursor and returns a message", () => {
	const s = make(lines, { row: 1, col: 2 });
	const r = press(s, "/", ...typeKeys("zzz"), "enter");
	assert.deepEqual(r.state.cursor, { row: 1, col: 2 });
	assert.deepEqual(r.effects, [{ type: "message", text: "Pattern not found: zzz" }]);
});

test("S6: n without a previous search reports a message", () => {
	const r = press(make(lines), "n");
	assert.deepEqual(r.effects, [{ type: "message", text: "No previous search" }]);
});

test("S6: search treats the query literally (no regex)", () => {
	const s = make(["a.c", "abc"], { row: 1 });
	const r = press(s, "/", ...typeKeys("a.c"), "enter").state;
	assert.deepEqual(r.cursor, { row: 0, col: 0 });
});
