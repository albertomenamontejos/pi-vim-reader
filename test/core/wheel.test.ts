import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollBy } from "../../src/core/index.ts";
import { make } from "./helpers.ts";

const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);

test("S20 wheel: scrolling down moves the viewport and pulls the cursor in only when it leaves", () => {
	const s = make(lines, { height: 10, row: 5 });
	const a = scrollBy(s, 3);
	assert.equal(a.top, 3);
	assert.deepEqual(a.cursor, { row: 5, col: 0 }, "cursor still visible: untouched");
	const b = scrollBy(s, 8);
	assert.equal(b.top, 8);
	assert.deepEqual(b.cursor, { row: 8, col: 0 }, "cursor pushed to the first visible row");
});

test("S20 wheel: scrolling up keeps the cursor inside the window and never goes past the top", () => {
	const s = { ...make(lines, { height: 10, row: 15 }), top: 10 };
	const a = scrollBy(s, -3);
	assert.equal(a.top, 7);
	assert.deepEqual(a.cursor, { row: 15, col: 0 });
	const b = scrollBy(s, -8);
	assert.equal(b.top, 2);
	assert.deepEqual(b.cursor, { row: 11, col: 0 }, "cursor pulled to the last visible row");
	assert.equal(scrollBy(s, -100).top, 0);
	assert.equal(scrollBy(make(lines, { height: 10, row: 0 }), -5).top, 0);
});

test("S20 wheel: reaching the end of the buffer follows live output again; leaving it detaches", () => {
	const s = make(lines, { height: 10, row: 0 });
	const end = scrollBy(s, 100);
	assert.equal(end.top, 20);
	assert.deepEqual(end.cursor, { row: 29, col: 0 });
	assert.equal(end.following, true);
	const up = scrollBy(end, -1);
	assert.equal(up.following, false);
	assert.equal(up.top, 19);
});

test("S20 wheel: a short buffer and an empty buffer are safe, and zero does nothing", () => {
	const short = make(["a", "b"], { height: 10, row: 0 });
	assert.deepEqual(scrollBy(short, 5).cursor, { row: 1, col: 0 });
	assert.equal(scrollBy(short, 5).top, 0);
	const empty = make([], { height: 5 });
	assert.deepEqual(scrollBy(empty, 3).cursor, { row: 0, col: 0 });
	const s = make(lines, { height: 10, row: 4 });
	assert.deepEqual(scrollBy(s, 0), s);
});
