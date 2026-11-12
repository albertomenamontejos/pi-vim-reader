import { test } from "node:test";
import assert from "node:assert/strict";
import { formatStatus, paintRows } from "../../src/ui/paint.ts";
import type { Slice } from "../../src/core/index.ts";

const style = {
	cursor: (s: string) => `[${s}]`,
	selection: (s: string) => `{${s}}`,
	match: (s: string) => `<${s}>`,
	filler: (s: string) => s,
};

function slice(rows: Slice["rows"], total = rows.length): Slice {
	return { top: rows[0]?.row ?? 0, total, rows };
}

test("S3 paint: always returns exactly `height` rows, padding with ~ filler", () => {
	const out = paintRows(slice([{ row: 0, text: "a", matches: [] }, { row: 1, text: "b", matches: [] }]), { width: 10, height: 4, style });
	assert.deepEqual(out, ["a", "b", "~", "~"]);
	const many = slice(Array.from({ length: 6 }, (_, i) => ({ row: i, text: `l${i}`, matches: [] })));
	assert.equal(paintRows(many, { width: 10, height: 3, style }).length, 3);
});

test("S1 paint: cursor cell is painted with the cursor style; empty cursor line shows a block", () => {
	const out = paintRows(slice([{ row: 0, text: "hello", cursorCol: 1, matches: [] }, { row: 1, text: "", cursorCol: 0, matches: [] }]), { width: 10, height: 2, style });
	assert.deepEqual(out, ["h[e]llo", "[ ]"]);
});

test("paint: lines longer than width are truncated", () => {
	const out = paintRows(slice([{ row: 0, text: "abcdefgh", matches: [] }]), { width: 5, height: 1, style });
	assert.deepEqual(out, ["abcde"]);
});

test("paint: cursor beyond the width scrolls that row horizontally so the cursor stays visible", () => {
	const out = paintRows(slice([{ row: 0, text: "abcdefgh", cursorCol: 7, matches: [] }]), { width: 5, height: 1, style });
	assert.deepEqual(out, ["defg[h]"]);
});

test("S7 paint: selection is painted; the cursor cell inside a selection uses the cursor style", () => {
	const out = paintRows(slice([{ row: 0, text: "hello world", cursorCol: 4, selection: { start: 0, end: 5 }, matches: [] }]), { width: 20, height: 1, style });
	assert.deepEqual(out, ["{hell}[o] world"]);
	const empty = paintRows(slice([{ row: 0, text: "", selection: { start: 0, end: 1 }, matches: [] }]), { width: 20, height: 1, style });
	assert.deepEqual(empty, ["{ }"]);
});

test("S6 paint: search matches are highlighted", () => {
	const out = paintRows(slice([{ row: 0, text: "hello world", matches: [{ start: 6, end: 11 }] }]), { width: 20, height: 1, style });
	assert.deepEqual(out, ["hello <world>"]);
});

test("paint: wide characters count two columns when truncating", () => {
	const out = paintRows(slice([{ row: 0, text: "日本語", cursorCol: 1, matches: [] }]), { width: 4, height: 1, style });
	assert.deepEqual(out, ["日[本]"]);
});

test("paint: tabs and control characters render as one column each (1:1 with core columns)", () => {
	const out = paintRows(slice([{ row: 0, text: "a\tb\x1bc", cursorCol: 2, matches: [] }]), { width: 20, height: 1, style });
	assert.deepEqual(out, ["a [b]?c"]);
});

test("paint: default style paints the cursor with ANSI inverse video", () => {
	const out = paintRows(slice([{ row: 0, text: "ab", cursorCol: 0, matches: [] }]), { width: 10, height: 1 });
	assert.equal(out[0], "\x1b[7ma\x1b[27mb");
});

test("S4 status: mode, FOLLOW, position and percent, padded to the exact width", () => {
	const s = formatStatus({ mode: "normal", following: true, row: 9, total: 10, message: "" }, 30);
	assert.equal(s, "NORMAL  FOLLOW      10/10 100%");
	assert.equal(s.length, 30);
});

test("S7 status: visual modes and last effect message", () => {
	assert.equal(
		formatStatus({ mode: "visual", following: false, row: 0, total: 4, message: "Copied 3 lines" }, 32),
		"VISUAL  Copied 3 lines   1/4 25%",
	);
	assert.match(formatStatus({ mode: "visual-line", following: false, row: 0, total: 4, message: "" }, 20), /^V-LINE /);
});

test("S6 status: search mode shows the typed query with its direction", () => {
	assert.match(formatStatus({ mode: "search", searchForward: true, searchInput: "foo", following: false, row: 0, total: 1, message: "" }, 20), /^\/foo /);
	assert.match(formatStatus({ mode: "search", searchForward: false, searchInput: "foo", following: false, row: 0, total: 1, message: "" }, 20), /^\?foo /);
});

test("status: empty buffer and narrow widths keep the exact width", () => {
	assert.equal(formatStatus({ mode: "normal", following: true, row: 0, total: 0, message: "" }, 12), "NORMAL   0/0");
	const narrow = formatStatus({ mode: "normal", following: true, row: 0, total: 4, message: "Pattern not found: x" }, 12);
	assert.equal(narrow, "NORM 1/4 25%");
	assert.equal(formatStatus({ mode: "normal", following: false, row: 0, total: 4, message: "" }, 3), "1/4");
});
