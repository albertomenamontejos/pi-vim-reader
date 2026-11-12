// Pure rendering of a core Slice into terminal rows, plus the status line.
// Styling is injected (theme-aware in the extension); defaults use raw ANSI.

import type { Mode, Range, Slice, SliceRow } from "../core/index.ts";
import { tokenize } from "./styled.ts";
import type { Measure } from "./styled.ts";

export interface PaintStyle {
	cursor(text: string): string;
	selection(text: string): string;
	match(text: string): string;
	filler(text: string): string;
}

export const DEFAULT_STYLE: PaintStyle = {
	cursor: (s) => `\x1b[7m${s}\x1b[27m`,
	selection: (s) => `\x1b[7m${s}\x1b[27m`,
	match: (s) => `\x1b[4m${s}\x1b[24m`,
	filler: (s) => s,
};

/** Terminal column width of a single code point (0 is never returned: controls render as 1 column). */
export function charWidth(cp: number): number {
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1f64f) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	) {
		return 2;
	}
	return 1;
}

/** Display form of one code point; keeps a 1:1 mapping with core columns. */
function displayChar(ch: string): string {
	if (ch === "\t") return " ";
	const cp = ch.codePointAt(0) ?? 0;
	if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0)) return "?";
	return ch;
}

type Kind = "plain" | "cursor" | "selection" | "match";

interface Cell {
	text: string;
	width: number;
	kind: Kind;
}

function inRange(i: number, r: Range): boolean {
	return i >= r.start && i < r.end;
}

function cellsFor(row: SliceRow): Cell[] {
	const cells: Cell[] = [];
	let index = 0; // UTF-16 offset, as used by core columns
	for (const ch of row.text) {
		const next = index + ch.length;
		const covers = (col: number) => col >= index && col < next;
		let kind: Kind = "plain";
		if (row.cursorCol !== undefined && covers(row.cursorCol)) kind = "cursor";
		else if (row.selection && inRange(index, row.selection)) kind = "selection";
		else if (row.matches.some((m) => inRange(index, m))) kind = "match";
		const text = displayChar(ch);
		cells.push({ text, width: charWidth(text.codePointAt(0) ?? 0), kind });
		index = next;
	}
	if (row.text.length === 0) {
		if (row.cursorCol !== undefined) cells.push({ text: " ", width: 1, kind: "cursor" });
		else if (row.selection) cells.push({ text: " ", width: 1, kind: "selection" });
	} else if (row.cursorCol !== undefined && row.cursorCol >= index) {
		cells.push({ text: " ", width: 1, kind: "cursor" });
	}
	return cells;
}

function paintRow(row: SliceRow, width: number, style: PaintStyle): string {
	const cells = cellsFor(row);
	// Horizontal scroll only when the cursor would fall off the right edge.
	let start = 0;
	const cursorIndex = cells.findIndex((c) => c.kind === "cursor");
	if (cursorIndex >= 0) {
		let used = 0;
		for (let i = 0; i <= cursorIndex; i++) used += cells[i]!.width;
		while (used > width && start < cursorIndex) used -= cells[start++]!.width;
	}
	let out = "";
	let used = 0;
	let runKind: Kind = "plain";
	let run = "";
	const flush = () => {
		if (run === "") return;
		out += runKind === "plain" ? run : style[runKind](run);
		run = "";
	};
	for (let i = start; i < cells.length; i++) {
		const cell = cells[i]!;
		if (used + cell.width > width) break;
		if (cell.kind !== runKind) {
			flush();
			runKind = cell.kind;
		}
		run += cell.text;
		used += cell.width;
	}
	flush();
	return out;
}

// ---------------------------------------------------------------------------
// Styled rows: the chat's own ANSI line with cursor/selection/matches on top.

const RESET = "\x1b[0m";
const SGR_RE = /^\x1b\[([0-9;:]*)m$/;

function kindAt(row: SliceRow, offset: number, length: number): Kind {
	if (row.cursorCol !== undefined && row.cursorCol >= offset && row.cursorCol < offset + length) return "cursor";
	if (row.selection && inRange(offset, row.selection)) return "selection";
	if (row.matches.some((m) => inRange(offset, m))) return "match";
	return "plain";
}

/** Default grapheme width: first code point via charWidth. The extension injects pi-tui's visibleWidth. */
const defaultMeasure: Measure = (g) => charWidth(g.codePointAt(0) ?? 0);

type StyledItem = { esc: string } | { cell: Cell };

function paintStyledRow(line: string, row: SliceRow, width: number, style: PaintStyle, measure: Measure): string {
	const items: StyledItem[] = [];
	let plainLength = 0;
	for (const t of tokenize(line)) {
		if (t.kind === "esc") {
			// APC (e.g. pi-tui's CURSOR_MARKER) is positional, not style: drop it.
			if (!t.text.startsWith("\x1b_")) items.push({ esc: t.text });
			continue;
		}
		const cp = t.text.codePointAt(0) ?? 0;
		const text = t.text.length === 1 || cp < 0x20 ? displayChar(t.text) : t.text;
		items.push({ cell: { text, width: Math.max(0, measure(text)), kind: kindAt(row, t.offset, t.text.length) } });
		plainLength = t.offset + t.text.length;
	}
	if (plainLength === 0 && row.cursorCol === undefined && row.selection) {
		items.push({ cell: { text: " ", width: 1, kind: "selection" } });
	} else if (row.cursorCol !== undefined && row.cursorCol >= plainLength) {
		items.push({ cell: { text: " ", width: 1, kind: "cursor" } });
	}

	// Horizontal scroll only when the cursor would fall off the right edge (same rule as plain rows).
	const cells = items.filter((it): it is { cell: Cell } => "cell" in it).map((it) => it.cell);
	let skip = 0;
	const cursorIndex = cells.findIndex((c) => c.kind === "cursor");
	if (cursorIndex >= 0) {
		let used = 0;
		for (let i = 0; i <= cursorIndex; i++) used += cells[i]!.width;
		while (used > width && skip < cursorIndex) used -= cells[skip++]!.width;
	}

	let out = "";
	let sgr = ""; // SGR codes active since the last reset, replayed after each highlight
	let used = 0;
	let index = 0;
	let clipped = false;
	let runKind: Kind = "plain";
	let run = "";
	const flush = () => {
		if (run === "") return;
		out += runKind === "plain" ? run : style[runKind](run) + RESET + sgr;
		run = "";
	};
	for (const it of items) {
		if ("esc" in it) {
			flush();
			out += it.esc;
			const m = SGR_RE.exec(it.esc);
			if (m) sgr = m[1] === "" || m[1] === "0" ? "" : /^0[;:]/.test(m[1]!) ? it.esc : sgr + it.esc;
			continue;
		}
		const cell = it.cell;
		if (index++ < skip || clipped) continue;
		if (used + cell.width > width) {
			clipped = true;
			continue;
		}
		if (cell.kind !== runKind) {
			flush();
			runKind = cell.kind;
		}
		run += cell.text;
		used += cell.width;
	}
	flush();
	return out;
}

export interface PaintOptions {
	width: number;
	height: number;
	style?: PaintStyle;
	/** Styled (ANSI) line per buffer row; rows without one use the plain painter. */
	styled?: readonly (string | undefined)[];
	/** Grapheme width for styled rows (pi-tui visibleWidth in the extension). */
	measure?: Measure;
}

/** Paint exactly `height` rows of at most `width` columns. */
export function paintRows(slice: Slice, opts: PaintOptions): string[] {
	const style = opts.style ?? DEFAULT_STYLE;
	const width = Math.max(1, Math.floor(opts.width));
	const height = Math.max(0, Math.floor(opts.height));
	const out: string[] = [];
	for (let i = 0; i < height; i++) {
		const row = slice.rows[i];
		const styled = row ? opts.styled?.[row.row] : undefined;
		if (!row) out.push(style.filler("~"));
		else if (styled !== undefined) out.push(paintStyledRow(styled, row, width, style, opts.measure ?? defaultMeasure));
		else out.push(paintRow(row, width, style));
	}
	return out;
}

// ---------------------------------------------------------------------------
// Status line

export interface StatusInfo {
	mode: Mode;
	searchForward?: boolean;
	searchInput?: string;
	following: boolean;
	/** 0-based cursor row. */
	row: number;
	total: number;
	message: string;
}

const MODE_LABEL: Record<Mode, string> = {
	normal: "NORMAL",
	visual: "VISUAL",
	"visual-line": "V-LINE",
	search: "",
};

function fit(text: string, width: number): string {
	if (width <= 0) return "";
	let out = "";
	let used = 0;
	for (const ch of text) {
		const w = charWidth(ch.codePointAt(0) ?? 0);
		if (used + w > width) break;
		out += ch;
		used += w;
	}
	return out + " ".repeat(width - used);
}

function textWidth(text: string): number {
	let w = 0;
	for (const ch of text) w += charWidth(ch.codePointAt(0) ?? 0);
	return w;
}

/** Plain-text status line of exactly `width` columns. */
export function formatStatus(info: StatusInfo, width: number): string {
	width = Math.max(0, Math.floor(width));
	const mode = info.mode === "search" ? `${info.searchForward === false ? "?" : "/"}${info.searchInput ?? ""}` : MODE_LABEL[info.mode];
	const left = [mode, info.following ? "FOLLOW" : "", info.message].filter((p) => p !== "").join("  ");
	const right = info.total > 0 ? `${info.row + 1}/${info.total} ${Math.round(((info.row + 1) / info.total) * 100)}%` : "0/0";
	const rightWidth = textWidth(right);
	if (rightWidth >= width) return fit(right, width);
	const room = width - rightWidth;
	if (textWidth(left) + 1 <= room) return fit(left, room) + right;
	return fit(left, room - 1) + " " + right;
}
