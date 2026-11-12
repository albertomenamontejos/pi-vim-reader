import { test } from "node:test";
import assert from "node:assert/strict";
import { createReader, setHeight, setLines, visibleSlice } from "../../src/core/index.ts";
import { make, press } from "./helpers.ts";

test("S4 model: createReader with follow starts on last line following", () => {
	const s = createReader(["a", "b", "c"], { height: 2 });
	assert.deepEqual(s.cursor, { row: 2, col: 0 });
	assert.equal(s.following, true);
	assert.equal(s.top, 1);
});

test("S4 model: leaving the last line detaches, G re-attaches", () => {
	const s = createReader(["a", "b", "c"], { height: 5 });
	const up = press(s, "k").state;
	assert.equal(up.following, false);
	assert.equal(press(up, "G").state.following, true);
	assert.equal(press(s, "l").state.following, true);
});

test("S4 model: setLines while following moves cursor to the new last line and scrolls", () => {
	const s = createReader(["a", "b"], { height: 2 });
	const next = setLines(s, ["a", "b", "c", "d"], [0, 0, 1, 1]);
	assert.deepEqual(next.cursor, { row: 3, col: 0 });
	assert.equal(next.following, true);
	assert.equal(next.top, 2);
	assert.deepEqual(next.lineMeta, [0, 0, 1, 1]);
});

test("S4 model: setLines while detached keeps cursor and viewport, clamping when lines shrink", () => {
	const s = press(createReader(["aaaa", "bbbb", "c"], { height: 5 }), "k", "$").state;
	const grown = setLines(s, ["aaaa", "bbbb", "c", "d"]);
	assert.deepEqual(grown.cursor, { row: 1, col: 3 });
	assert.equal(grown.following, false);
	const shrunk = setLines(s, ["aa"]);
	assert.deepEqual(shrunk.cursor, { row: 0, col: 1 });
});

test("render: visibleSlice returns viewport rows with cursor column", () => {
	const lines = ["l0", "l1", "l2", "l3", "l4"];
	const s = make(lines, { height: 2, row: 0 });
	const moved = press(s, "j", "j", "l").state;
	const slice = visibleSlice(moved);
	assert.deepEqual(
		slice.rows.map((r) => [r.row, r.text, r.cursorCol]),
		[
			[1, "l1", undefined],
			[2, "l2", 1],
		],
	);
});

test("render: visibleSlice reports charwise and linewise selection ranges (end exclusive)", () => {
	const lines = ["hello", "", "world"];
	const v = press(make(lines, { row: 0, col: 2 }), "v", "j", "j").state;
	assert.deepEqual(
		visibleSlice(v).rows.map((r) => r.selection),
		[
			{ start: 2, end: 5 },
			{ start: 0, end: 1 },
			{ start: 0, end: 3 },
		],
	);
	const V = press(make(lines, { row: 0, col: 2 }), "V", "j").state;
	assert.deepEqual(
		visibleSlice(V).rows.map((r) => r.selection),
		[{ start: 0, end: 5 }, { start: 0, end: 1 }, undefined],
	);
});

test("render: visibleSlice reports search matches for the last query", () => {
	const s = press(make(["foo bar foo", "x"], { row: 1 }), "/", "f", "o", "o", "enter").state;
	assert.deepEqual(visibleSlice(s).rows[0]?.matches, [
		{ start: 0, end: 3 },
		{ start: 8, end: 11 },
	]);
	assert.deepEqual(visibleSlice(s).rows[1]?.matches, []);
});

test("render: setHeight clamps viewport and keeps cursor visible", () => {
	const lines = Array.from({ length: 20 }, (_, i) => `${i}`);
	const s = createReader(lines, { height: 10 });
	const small = setHeight(s, 3);
	assert.equal(small.top, 17);
	assert.equal(visibleSlice(small).rows.length, 3);
});
