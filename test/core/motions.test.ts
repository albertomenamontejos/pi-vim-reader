import { test } from "node:test";
import assert from "node:assert/strict";
import { createReader } from "../../src/core/index.ts";
import { make, press } from "./helpers.ts";

const text = ["hello world", "", "foo.bar(baz)", "  indented line"];

test("S1: reader never mutates lines for any key", () => {
	const s = make([...text]);
	const { state } = press(s, "x", "d", "d", "i", "a", "p", "u", "j", "w");
	assert.deepEqual(state.lines, text);
});

test("S5: h/l move within line and clamp at both ends", () => {
	const s = make(["abc"]);
	assert.deepEqual(press(s, "h").state.cursor, { row: 0, col: 0 });
	assert.deepEqual(press(s, "l", "l").state.cursor, { row: 0, col: 2 });
	assert.deepEqual(press(s, "l", "l", "l", "l").state.cursor, { row: 0, col: 2 });
});

test("S5: j/k move rows, clamp at top/bottom, clamp col on short and empty lines, remember column", () => {
	const s = make(text, { row: 0, col: 8 });
	assert.deepEqual(press(s, "k").state.cursor, { row: 0, col: 8 });
	assert.deepEqual(press(s, "j").state.cursor, { row: 1, col: 0 });
	assert.deepEqual(press(s, "j", "j").state.cursor, { row: 2, col: 8 });
	assert.deepEqual(press(s, "j", "j", "j", "j", "j").state.cursor, { row: 3, col: 8 });
});

test("S5: 0 and $ go to line start and last char (0 on empty line)", () => {
	const s = make(text, { row: 0, col: 4 });
	assert.deepEqual(press(s, "$").state.cursor, { row: 0, col: 10 });
	assert.deepEqual(press(s, "$", "0").state.cursor, { row: 0, col: 0 });
	assert.deepEqual(press(make(text, { row: 1 }), "$").state.cursor, { row: 1, col: 0 });
});

test("S5: w moves to next word start, splitting word/punctuation and stopping on empty lines", () => {
	const s = make(text, { row: 0, col: 0 });
	const positions = [];
	let cur = s;
	for (let i = 0; i < 9; i++) {
		cur = press(cur, "w").state;
		positions.push([cur.cursor.row, cur.cursor.col]);
	}
	assert.deepEqual(positions, [
		[0, 6], // world
		[1, 0], // empty line
		[2, 0], // foo
		[2, 3], // .
		[2, 4], // bar
		[2, 7], // (
		[2, 8], // baz
		[2, 11], // )
		[3, 2], // indented
	]);
	const end = press(cur, "w", "w", "w", "w").state;
	assert.deepEqual(end.cursor, { row: 3, col: 14 });
});

test("S5: e moves to end of word, crossing lines and skipping empty lines", () => {
	const s = make(text, { row: 0, col: 0 });
	const positions = [];
	let cur = s;
	for (let i = 0; i < 4; i++) {
		cur = press(cur, "e").state;
		positions.push([cur.cursor.row, cur.cursor.col]);
	}
	assert.deepEqual(positions, [
		[0, 4],
		[0, 10],
		[2, 2],
		[2, 3],
	]);
});

test("S5: b moves to previous word start, stopping on empty lines and clamping at buffer start", () => {
	const s = make(text, { row: 3, col: 2 });
	const positions = [];
	let cur = s;
	for (let i = 0; i < 6; i++) {
		cur = press(cur, "b").state;
		positions.push([cur.cursor.row, cur.cursor.col]);
	}
	assert.deepEqual(positions, [
		[2, 11],
		[2, 8],
		[2, 7],
		[2, 4],
		[2, 3],
		[2, 0],
	]);
	const more = press(cur, "b", "b", "b", "b", "b").state;
	assert.deepEqual(more.cursor, { row: 0, col: 0 });
});

test("S5: gg goes to first line and G to last line", () => {
	const s = make(text, { row: 2, col: 5 });
	assert.deepEqual(press(s, "g", "g").state.cursor, { row: 0, col: 0 });
	assert.deepEqual(press(s, "G").state.cursor, { row: 3, col: 0 });
	assert.equal(press(s, "g").state.pending, "g");
	assert.equal(press(s, "g", "z").state.pending, "");
});

test("S5: ctrl+d / ctrl+u move cursor and viewport by half a page, clamped", () => {
	const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
	const s = make(lines, { height: 10, row: 0 });
	const d1 = press(s, "ctrl+d").state;
	assert.equal(d1.cursor.row, 5);
	assert.equal(d1.top, 5);
	const dEnd = press(s, "ctrl+d", "ctrl+d", "ctrl+d", "ctrl+d", "ctrl+d", "ctrl+d", "ctrl+d").state;
	assert.equal(dEnd.cursor.row, 29);
	assert.equal(dEnd.top, 20);
	const u1 = press(dEnd, "ctrl+u").state;
	assert.equal(u1.cursor.row, 24);
	assert.equal(u1.top, 15);
	const uTop = press(dEnd, "ctrl+u", "ctrl+u", "ctrl+u", "ctrl+u", "ctrl+u", "ctrl+u", "ctrl+u").state;
	assert.equal(uTop.cursor.row, 0);
	assert.equal(uTop.top, 0);
});

test("S5: viewport scrolls to keep cursor visible", () => {
	const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
	const s = make(lines, { height: 5, row: 0 });
	const down = press(s, "j", "j", "j", "j", "j", "j").state;
	assert.equal(down.cursor.row, 6);
	assert.equal(down.top, 2);
	const g = press(s, "G").state;
	assert.equal(g.top, 25);
	const back = press(g, "g", "g").state;
	assert.equal(back.top, 0);
});

test("S5: ]] and [[ jump between message starts using lineMeta", () => {
	const lines = ["u1", "a1", "a1b", "a1c", "t1", "u2"];
	const meta = [0, 1, 1, 1, 2, 3];
	const s = make(lines, { meta, row: 0 });
	const n1 = press(s, "]", "]").state;
	assert.deepEqual(n1.cursor, { row: 1, col: 0 });
	const n2 = press(n1, "]", "]", "]", "]").state;
	assert.deepEqual(n2.cursor, { row: 5, col: 0 });
	assert.deepEqual(press(n2, "]", "]").state.cursor, { row: 5, col: 0 });
	const mid = make(lines, { meta, row: 3, col: 1 });
	assert.deepEqual(press(mid, "[", "[").state.cursor, { row: 1, col: 0 });
	assert.deepEqual(press(mid, "[", "[", "[", "[").state.cursor, { row: 0, col: 0 });
	assert.deepEqual(press(make(lines, { meta, row: 0 }), "[", "[").state.cursor, { row: 0, col: 0 });
});

test("S5: empty buffer is safe for every motion", () => {
	const s = createReader([], { height: 5 });
	const { state } = press(s, "j", "k", "w", "b", "e", "$", "0", "G", "g", "g", "ctrl+d", "ctrl+u", "]", "]");
	assert.deepEqual(state.cursor, { row: 0, col: 0 });
});
