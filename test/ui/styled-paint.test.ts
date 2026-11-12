import { test } from "node:test";
import assert from "node:assert/strict";
import { paintRows } from "../../src/ui/paint.ts";
import type { Slice, SliceRow } from "../../src/core/index.ts";

const style = {
	cursor: (s: string) => `[${s}]`,
	selection: (s: string) => `{${s}}`,
	match: (s: string) => `<${s}>`,
	filler: (s: string) => s,
};
const R = "\x1b[0m";

function paintOne(styled: string, row: Omit<SliceRow, "row" | "text"> & { text: string }, width = 40): string {
	const slice: Slice = { top: 0, total: 1, rows: [{ row: 0, ...row }] };
	return paintRows(slice, { width, height: 1, style, styled: [styled] })[0]!;
}

test("styled paint: without highlights the styled line is emitted unchanged", () => {
	const line = "\x1b[1m\x1b[36mTitle\x1b[39m\x1b[22m plain";
	assert.equal(paintOne(line, { text: "Title plain", matches: [] }), line);
});

test("S1 styled paint: original styling is kept outside the cursor cell and restored after it", () => {
	const out = paintOne("\x1b[1mab\x1b[22mcd", { text: "abcd", cursorCol: 1, matches: [] });
	assert.equal(out, `\x1b[1ma[b]${R}\x1b[1m\x1b[22mcd`);
});

test("styled paint: cursor on a wide char and on an emoji (surrogate pair) highlights the whole grapheme", () => {
	assert.equal(paintOne("a界b", { text: "a界b", cursorCol: 1, matches: [] }), `a[界]${R}b`);
	assert.equal(paintOne("a😀b", { text: "a😀b", cursorCol: 1, matches: [] }), `a[😀]${R}b`);
	assert.equal(paintOne("a😀b", { text: "a😀b", cursorCol: 3, matches: [] }), `a😀[b]${R}`);
	// Width budget counts terminal cells: "a界" is 3 cells.
	assert.equal(paintOne("a界b", { text: "a界b", matches: [] }, 3), "a界");
});

test("S7 styled paint: selection across styled spans keeps every span's own codes", () => {
	const line = "\x1b[31mred\x1b[39m \x1b[32mgreen\x1b[39m";
	const out = paintOne(line, { text: "red green", selection: { start: 1, end: 7 }, matches: [] });
	assert.equal(
		out,
		`\x1b[31mr{ed}${R}\x1b[31m\x1b[39m{ }${R}\x1b[31m\x1b[39m\x1b[32m{gre}${R}\x1b[31m\x1b[39m\x1b[32men\x1b[39m`,
	);
});

test("S6 styled paint: search matches are highlighted on the styled line", () => {
	const out = paintOne("\x1b[2mfoo bar foo\x1b[22m", { text: "foo bar foo", matches: [{ start: 0, end: 3 }, { start: 8, end: 11 }] });
	assert.equal(out, `\x1b[2m<foo>${R}\x1b[2m bar <foo>${R}\x1b[2m\x1b[22m`);
});

test("styled paint: OSC 8 hyperlinks stay intact around the cursor; APC cursor markers are dropped", () => {
	const line = "\x1b]8;;https://x.io\x07link\x1b]8;;\x07\x1b_pi:c\x07";
	assert.equal(paintOne(line, { text: "link", cursorCol: 0, matches: [] }), `\x1b]8;;https://x.io\x07[l]${R}ink\x1b]8;;\x07`);
});

test("styled paint: empty line and cursor past the end show a cursor block; long lines clip but keep trailing codes", () => {
	assert.equal(paintOne("", { text: "", cursorCol: 0, matches: [] }), `[ ]${R}`);
	assert.equal(paintOne("\x1b[1mabcdef\x1b[22m", { text: "abcdef", matches: [] }, 4), "\x1b[1mabcd\x1b[22m");
	assert.equal(paintOne("\x1b[1mabcdef\x1b[22m", { text: "abcdef", cursorCol: 5, matches: [] }, 4), `\x1b[1mcde[f]${R}\x1b[1m\x1b[22m`);
});

test("styled paint: rows without a styled line use the plain painter; height is exact", () => {
	const slice: Slice = { top: 0, total: 2, rows: [{ row: 0, text: "ab", cursorCol: 0, matches: [] }, { row: 1, text: "cd", matches: [] }] };
	const out = paintRows(slice, { width: 10, height: 3, style, styled: ["\x1b[1mab\x1b[22m"] });
	assert.deepEqual(out, [`\x1b[1m[a]${R}\x1b[1mb\x1b[22m`, "cd", "~"]);
});

test("styled paint: injected measure decides grapheme width", () => {
	const slice: Slice = { top: 0, total: 1, rows: [{ row: 0, text: "❤️x", matches: [] }] };
	const measure = (g: string) => (g === "❤️" ? 2 : 1);
	assert.deepEqual(paintRows(slice, { width: 2, height: 1, style, styled: ["❤️x"], measure }), ["❤️"]);
});

test("styled paint: padded chat lines highlight on the padding cells when the plain text is trimmed", () => {
	// Plain text "ab" (trimmed); styled line keeps Pi's padding.
	assert.equal(paintOne("ab  ", { text: "ab", cursorCol: 1, matches: [] }), `a[b]${R}  `);
	assert.equal(paintOne("    ", { text: "", cursorCol: 0, matches: [] }), `[ ]${R}   `);
	assert.equal(paintOne("    ", { text: "", selection: { start: 0, end: 1 }, matches: [] }), `{ }${R}   `);
});
