// Pure, read-only vim-style reader state machine. No I/O: side effects are returned as data.

import { codeBlockAt, fileAt, findInLine, searchFrom, urlAt, wordBackward, wordEnd, wordForward } from "./text.ts";
import type { Pos, Range } from "./text.ts";

export type Mode = "normal" | "visual" | "visual-line" | "search";

export type Effect =
	| { type: "copy"; text: string }
	| { type: "open-url"; url: string }
	| { type: "open-file"; path: string; line?: number }
	| { type: "close" }
	| { type: "message"; text: string };

export interface ReaderState {
	readonly lines: readonly string[];
	/** Message index per line; a change between consecutive rows marks a message start. */
	readonly lineMeta: readonly number[];
	readonly cursor: Pos;
	/** Desired column for vertical motions; null means "use cursor.col". */
	readonly wantCol: number | null;
	readonly top: number;
	readonly height: number;
	readonly mode: Mode;
	readonly pending: string;
	readonly anchor: Pos | null;
	readonly searchInput: string;
	readonly searchQuery: string | null;
	readonly searchForward: boolean;
	/** Mode to return to when leaving search input. */
	readonly searchReturn: Mode;
	readonly following: boolean;
}

export interface HandleResult {
	state: ReaderState;
	effect?: Effect;
}

export interface CreateOptions {
	meta?: readonly number[];
	height?: number;
	/** Start on the last line following live output (default true). */
	follow?: boolean;
}

// ---------------------------------------------------------------------------
// Construction and external updates

export function createReader(lines: readonly string[], opts: CreateOptions = {}): ReaderState {
	const follow = opts.follow ?? true;
	const base: ReaderState = {
		lines: [...lines],
		lineMeta: [...(opts.meta ?? [])],
		cursor: { row: 0, col: 0 },
		wantCol: null,
		top: 0,
		height: Math.max(1, opts.height ?? 20),
		mode: "normal",
		pending: "",
		anchor: null,
		searchInput: "",
		searchQuery: null,
		searchForward: true,
		searchReturn: "normal",
		following: false,
	};
	if (!follow) return base;
	return scroll({ ...base, cursor: { row: lastRow(base), col: 0 }, following: true });
}

/** Replace buffer contents (live streaming). Following readers jump to the new last line. */
export function setLines(state: ReaderState, lines: readonly string[], meta?: readonly number[]): ReaderState {
	const next: ReaderState = { ...state, lines: [...lines], lineMeta: meta ? [...meta] : state.lineMeta };
	if (state.following) return scroll({ ...next, cursor: { row: lastRow(next), col: 0 }, wantCol: null });
	const row = clamp(state.cursor.row, 0, lastRow(next));
	const anchor = state.anchor ? clampPos(next, state.anchor) : null;
	return clampTop({ ...next, cursor: { row, col: clampCol(next, row, state.cursor.col) }, anchor });
}

export function setHeight(state: ReaderState, height: number): ReaderState {
	return scroll({ ...state, height: Math.max(1, Math.floor(height)) });
}

// ---------------------------------------------------------------------------
// Rendering

export interface SliceRow {
	row: number;
	text: string;
	cursorCol?: number;
	/** Selected columns, end exclusive. Empty selected lines report {0,1}. */
	selection?: Range;
	matches: Range[];
}

export interface Slice {
	top: number;
	total: number;
	rows: SliceRow[];
}

export function visibleSlice(state: ReaderState): Slice {
	const query = state.mode === "search" ? state.searchInput : (state.searchQuery ?? "");
	const sel = selectionBounds(state);
	const rows: SliceRow[] = [];
	const end = Math.min(state.lines.length, state.top + state.height);
	for (let row = state.top; row < end; row++) {
		const text = state.lines[row] ?? "";
		const r: SliceRow = { row, text, matches: findInLine(text, query) };
		if (row === state.cursor.row) r.cursorCol = state.cursor.col;
		if (sel && row >= sel.start.row && row <= sel.end.row) {
			if (text.length === 0) r.selection = { start: 0, end: 1 };
			else if (sel.linewise) r.selection = { start: 0, end: text.length };
			else {
				const start = row === sel.start.row ? sel.start.col : 0;
				const stop = row === sel.end.row ? Math.min(text.length, sel.end.col + 1) : text.length;
				r.selection = { start, end: stop };
			}
		}
		rows.push(r);
	}
	return { top: state.top, total: state.lines.length, rows };
}

// ---------------------------------------------------------------------------
// Key handling

export function handleKey(state: ReaderState, key: string): HandleResult {
	if (state.mode === "search") return handleSearchKey(state, key);
	if (state.pending !== "") return handlePending({ ...state, pending: "" }, state.pending + key);

	const visual = state.mode === "visual" || state.mode === "visual-line";
	switch (key) {
		case "escape":
			if (visual) return { state: { ...state, mode: "normal", anchor: null } };
			return { state, effect: { type: "close" } };
		case "q":
			return visual ? { state } : { state, effect: { type: "close" } };
		case "g":
		case "]":
		case "[":
			return { state: { ...state, pending: key } };
		case "y":
			if (visual) return yankSelection(state);
			return { state: { ...state, pending: "y" } };
		case "v":
		case "V": {
			const target: Mode = key === "v" ? "visual" : "visual-line";
			if (state.mode === target) return { state: { ...state, mode: "normal", anchor: null } };
			return { state: { ...state, mode: target, anchor: visual ? state.anchor : { ...state.cursor } } };
		}
		case "/":
		case "?":
			return {
				state: { ...state, mode: "search", searchInput: "", searchForward: key === "/", searchReturn: state.mode },
			};
		case "n":
		case "N":
			return repeatSearch(state, key === "n");
		case "ctrl+d":
		case "ctrl+u":
			return { state: scrollHalf(state, key === "ctrl+d" ? 1 : -1) };
	}
	const pos = motion(state, key);
	return pos ? { state: moveTo(state, pos) } : { state };
}

function handlePending(state: ReaderState, seq: string): HandleResult {
	switch (seq) {
		case "gg":
			return { state: moveTo(state, { row: 0, col: 0 }) };
		case "]]":
			return { state: moveTo(state, nextMessageStart(state)) };
		case "[[":
			return { state: moveTo(state, prevMessageStart(state)) };
		case "yy":
			return { state, effect: { type: "copy", text: state.lines[state.cursor.row] ?? "" } };
		case "yc": {
			const code = codeBlockAt([...state.lines], state.cursor.row);
			return { state, effect: code === null ? message("No code block") : { type: "copy", text: code } };
		}
		case "gx": {
			const url = urlAt(currentLine(state), state.cursor.col);
			return { state, effect: url === null ? message("No URL under cursor") : { type: "open-url", url } };
		}
		case "gf": {
			const ref = fileAt(currentLine(state), state.cursor.col);
			if (ref === null) return { state, effect: message("No file under cursor") };
			const effect: Effect = ref.line === undefined ? { type: "open-file", path: ref.path } : { type: "open-file", path: ref.path, line: ref.line };
			return { state, effect };
		}
	}
	return { state };
}

// ---------------------------------------------------------------------------
// Search

function handleSearchKey(state: ReaderState, key: string): HandleResult {
	const leave = (s: ReaderState): ReaderState => ({
		...s,
		mode: s.searchReturn,
		searchInput: "",
		anchor: s.searchReturn === "normal" ? null : s.anchor,
	});
	if (key === "escape") return { state: leave(state) };
	if (key === "backspace") {
		if (state.searchInput === "") return { state: leave(state) };
		return { state: { ...state, searchInput: [...state.searchInput].slice(0, -1).join("") } };
	}
	if (key === "enter") {
		const query = state.searchInput !== "" ? state.searchInput : state.searchQuery;
		const done = leave(state);
		if (query === null || query === "") return { state: done };
		return runSearch({ ...done, searchQuery: query }, query, state.searchForward);
	}
	const ch = key === "space" ? " " : key;
	if ([...ch].length === 1) return { state: { ...state, searchInput: state.searchInput + ch } };
	return { state };
}

function repeatSearch(state: ReaderState, same: boolean): HandleResult {
	if (state.searchQuery === null) return { state, effect: message("No previous search") };
	return runSearch(state, state.searchQuery, same ? state.searchForward : !state.searchForward);
}

function runSearch(state: ReaderState, query: string, forward: boolean): HandleResult {
	const hit = state.lines.length ? searchFrom([...state.lines], state.cursor, query, forward) : null;
	if (!hit) return { state, effect: message(`Pattern not found: ${query}`) };
	const moved = moveTo(state, hit.pos);
	if (!hit.wrapped) return { state: moved };
	return {
		state: moved,
		effect: message(forward ? "search hit BOTTOM, continuing at TOP" : "search hit TOP, continuing at BOTTOM"),
	};
}

// ---------------------------------------------------------------------------
// Selection

interface Bounds {
	start: Pos;
	end: Pos;
	linewise: boolean;
}

function selectionBounds(state: ReaderState): Bounds | null {
	const mode = state.mode === "search" ? state.searchReturn : state.mode;
	if ((mode !== "visual" && mode !== "visual-line") || !state.anchor) return null;
	const a = state.anchor;
	const c = state.cursor;
	const aFirst = a.row < c.row || (a.row === c.row && a.col <= c.col);
	return { start: aFirst ? a : c, end: aFirst ? c : a, linewise: mode === "visual-line" };
}

function yankSelection(state: ReaderState): HandleResult {
	const sel = selectionBounds(state);
	const done: ReaderState = { ...state, mode: "normal", anchor: null };
	if (!sel) return { state: done };
	const { start, end } = sel;
	const picked = state.lines.slice(start.row, end.row + 1);
	let text: string;
	let cursor: Pos;
	if (sel.linewise) {
		text = picked.join("\n");
		cursor = { row: start.row, col: clampCol(state, start.row, state.cursor.col) };
	} else {
		const parts = picked.map((line, i) => {
			const row = start.row + i;
			const from = row === start.row ? start.col : 0;
			const to = row === end.row ? end.col + 1 : line.length;
			return line.slice(from, to);
		});
		text = parts.join("\n");
		cursor = start;
	}
	return { state: moveTo(done, cursor), effect: { type: "copy", text } };
}

// ---------------------------------------------------------------------------
// Motions

function motion(state: ReaderState, key: string): (Pos & { want?: number | null }) | null {
	const lines = state.lines.length ? [...state.lines] : [""];
	const { row, col } = state.cursor;
	const vertical = (target: number): Pos & { want: number } => {
		const want = state.wantCol ?? col;
		const r = clamp(target, 0, lines.length - 1);
		return { row: r, col: clampCol(state, r, want), want };
	};
	switch (key) {
		case "h":
		case "left":
			return { row, col: Math.max(0, col - 1) };
		case "l":
		case "right":
			return { row, col: clampCol(state, row, col + 1) };
		case "j":
		case "down":
			return vertical(row + 1);
		case "k":
		case "up":
			return vertical(row - 1);
		case "0":
		case "home":
			return { row, col: 0 };
		case "$":
		case "end":
			return { row, col: clampCol(state, row, Number.MAX_SAFE_INTEGER), want: Number.MAX_SAFE_INTEGER };
		case "w":
			return wordForward(lines, state.cursor);
		case "b":
			return wordBackward(lines, state.cursor);
		case "e":
			return wordEnd(lines, state.cursor);
		case "G":
			return { row: lines.length - 1, col: 0 };
	}
	return null;
}

/** ctrl+d / ctrl+u: move viewport and cursor by half a page, clamped to the buffer. */
function scrollHalf(state: ReaderState, dir: 1 | -1): ReaderState {
	const half = Math.max(1, Math.floor(state.height / 2));
	const top = clamp(state.top + dir * half, 0, maxTop(state));
	const row = clamp(state.cursor.row + dir * half, 0, lastRow(state));
	const want = state.wantCol ?? state.cursor.col;
	return moveTo({ ...state, top }, { row, col: clampCol(state, row, want), want });
}

/** Apply a cursor move: update wantCol, viewport and follow state. */
function moveTo(state: ReaderState, pos: Pos & { want?: number | null }): ReaderState {
	const next: ReaderState = {
		...state,
		cursor: { row: pos.row, col: pos.col },
		wantCol: pos.want === undefined ? null : pos.want,
	};
	return scroll({ ...next, following: next.cursor.row === lastRow(next) });
}

function nextMessageStart(state: ReaderState): Pos {
	const meta = state.lineMeta;
	for (let r = state.cursor.row + 1; r < state.lines.length; r++) {
		if (meta[r] !== meta[r - 1]) return { row: r, col: 0 };
	}
	return { row: lastRow(state), col: 0 };
}

function prevMessageStart(state: ReaderState): Pos {
	const meta = state.lineMeta;
	for (let r = Math.min(state.cursor.row, state.lines.length) - 1; r > 0; r--) {
		if (meta[r] !== meta[r - 1]) return { row: r, col: 0 };
	}
	return { row: 0, col: 0 };
}

// ---------------------------------------------------------------------------
// Helpers

function message(text: string): Effect {
	return { type: "message", text };
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

function lastRow(state: Pick<ReaderState, "lines">): number {
	return Math.max(0, state.lines.length - 1);
}

function currentLine(state: ReaderState): string {
	return state.lines[state.cursor.row] ?? "";
}

function clampCol(state: Pick<ReaderState, "lines">, row: number, col: number): number {
	const len = state.lines[row]?.length ?? 0;
	return clamp(col, 0, Math.max(0, len - 1));
}

function clampPos(state: Pick<ReaderState, "lines">, p: Pos): Pos {
	const row = clamp(p.row, 0, lastRow(state));
	return { row, col: clampCol(state, row, p.col) };
}

function maxTop(state: ReaderState): number {
	return Math.max(0, state.lines.length - state.height);
}

function clampTop(state: ReaderState): ReaderState {
	return { ...state, top: clamp(state.top, 0, maxTop(state)) };
}

/** Scroll the viewport the minimum needed to keep the cursor visible. */
function scroll(state: ReaderState): ReaderState {
	let top = state.top;
	const row = state.cursor.row;
	if (row < top) top = row;
	if (row >= top + state.height) top = row - state.height + 1;
	return clampTop({ ...state, top });
}
