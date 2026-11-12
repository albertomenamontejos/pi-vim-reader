// Pure text helpers: word motions, URL/path/code-block detection, literal search.

export interface Pos {
	row: number;
	col: number;
}

/** 0 = whitespace/newline, 1 = punctuation, 2 = word char ([A-Za-z0-9_]). */
export function charClass(ch: string | undefined): number {
	if (ch === undefined || /\s/.test(ch)) return 0;
	if (/\w/.test(ch)) return 2;
	return 1;
}

// Positions run over every char of each line plus a virtual newline at col === length.
function classAt(lines: string[], p: Pos): number {
	return charClass(lines[p.row]?.[p.col]);
}

function next(lines: string[], p: Pos): Pos | null {
	const len = lines[p.row]?.length ?? 0;
	if (p.col < len) return { row: p.row, col: p.col + 1 };
	if (p.row + 1 < lines.length) return { row: p.row + 1, col: 0 };
	return null;
}

function prev(lines: string[], p: Pos): Pos | null {
	if (p.col > 0) return { row: p.row, col: p.col - 1 };
	if (p.row > 0) return { row: p.row - 1, col: lines[p.row - 1]?.length ?? 0 };
	return null;
}

function lastPos(lines: string[]): Pos {
	const row = lines.length - 1;
	return { row, col: Math.max(0, (lines[row]?.length ?? 0) - 1) };
}

const isEmptyLine = (lines: string[], row: number): boolean => (lines[row]?.length ?? 0) === 0;

export function wordForward(lines: string[], cur: Pos): Pos {
	let row = cur.row;
	let col = cur.col;
	const start = classAt(lines, cur);
	if (start !== 0) {
		while (col < lines[row].length && charClass(lines[row][col]) === start) col++;
	}
	for (;;) {
		if (col >= lines[row].length) {
			if (row === lines.length - 1) return lastPos(lines);
			row++;
			col = 0;
			if (isEmptyLine(lines, row)) return { row, col: 0 };
			continue;
		}
		if (charClass(lines[row][col]) === 0) {
			col++;
			continue;
		}
		return { row, col };
	}
}

export function wordEnd(lines: string[], cur: Pos): Pos {
	let p = next(lines, cur);
	if (!p) return cur;
	while (p && classAt(lines, p) === 0) p = next(lines, p);
	if (!p) return lastPos(lines);
	const cls = classAt(lines, p);
	for (;;) {
		const n = next(lines, p);
		if (n && n.row === p.row && classAt(lines, n) === cls) p = n;
		else return p;
	}
}

export function wordBackward(lines: string[], cur: Pos): Pos {
	let p = prev(lines, cur);
	if (!p) return cur;
	while (p && classAt(lines, p) === 0 && !isEmptyLine(lines, p.row)) p = prev(lines, p);
	if (!p) return { row: 0, col: 0 };
	if (isEmptyLine(lines, p.row)) return { row: p.row, col: 0 };
	const cls = classAt(lines, p);
	for (;;) {
		const q = prev(lines, p);
		if (q && q.row === p.row && classAt(lines, q) === cls) p = q;
		else return p;
	}
}

// ---------------------------------------------------------------------------
// Search (literal, smartcase)

export interface Range {
	start: number;
	end: number;
}

export function isCaseSensitive(query: string): boolean {
	return query !== query.toLowerCase();
}

export function findInLine(line: string, query: string): Range[] {
	if (query === "") return [];
	const sensitive = isCaseSensitive(query);
	const hay = sensitive ? line : line.toLowerCase();
	const needle = sensitive ? query : query.toLowerCase();
	const out: Range[] = [];
	let i = hay.indexOf(needle);
	while (i !== -1) {
		out.push({ start: i, end: i + needle.length });
		i = hay.indexOf(needle, i + 1);
	}
	return out;
}

export interface SearchHit {
	pos: Pos;
	wrapped: boolean;
}

export function searchFrom(lines: string[], cur: Pos, query: string, forward: boolean): SearchHit | null {
	const n = lines.length;
	if (forward) {
		for (let step = 0; step <= n; step++) {
			const row = (cur.row + step) % n;
			const wrapped = cur.row + step >= n;
			const hit = findInLine(lines[row], query).find((m) =>
				step === 0 ? m.start > cur.col : step === n ? m.start <= cur.col : true,
			);
			if (hit) return { pos: { row, col: hit.start }, wrapped };
		}
	} else {
		for (let step = 0; step <= n; step++) {
			const row = (((cur.row - step) % n) + n) % n;
			const wrapped = cur.row - step < 0;
			const hits = findInLine(lines[row], query).filter((m) =>
				step === 0 ? m.start < cur.col : step === n ? m.start >= cur.col : true,
			);
			const hit = hits[hits.length - 1];
			if (hit) return { pos: { row, col: hit.start }, wrapped };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Code blocks

const FENCE = /^\s*(```|~~~)/;

export function codeBlockAt(lines: string[], row: number): string | null {
	let open: number | null = null;
	let marker = "";
	for (let i = 0; i < lines.length; i++) {
		const m = FENCE.exec(lines[i]);
		if (!m) continue;
		if (open === null) {
			open = i;
			marker = m[1];
		} else if (m[1] === marker) {
			if (row >= open && row <= i) return lines.slice(open + 1, i).join("\n");
			open = null;
		}
	}
	if (open !== null && row >= open) return lines.slice(open + 1).join("\n");
	return null;
}

// ---------------------------------------------------------------------------
// URLs and file paths

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCT = /[.,;:!?'"]$/;

function count(s: string, ch: string): number {
	let n = 0;
	for (const c of s) if (c === ch) n++;
	return n;
}

function stripUrlTail(url: string): string {
	let u = url;
	for (;;) {
		if (TRAILING_PUNCT.test(u)) {
			u = u.slice(0, -1);
			continue;
		}
		const last = u[u.length - 1];
		const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };
		const open = last === undefined ? undefined : pairs[last];
		if (open !== undefined && count(u, last) > count(u, open)) {
			u = u.slice(0, -1);
			continue;
		}
		return u;
	}
}

export function urlAt(line: string, col: number): string | null {
	for (const m of line.matchAll(URL_RE)) {
		const start = m.index ?? 0;
		const url = stripUrlTail(m[0]);
		if (col >= start && col < start + url.length) return url;
	}
	return null;
}

export interface FileRef {
	path: string;
	line?: number;
}

export function fileAt(line: string, col: number): FileRef | null {
	if (col < 0 || col >= line.length || /\s/.test(line[col])) return null;
	let s = col;
	let e = col;
	while (s > 0 && !/\s/.test(line[s - 1])) s--;
	while (e < line.length && !/\s/.test(line[e])) e++;
	let token = line.slice(s, e);
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token.replace(/^[`'"(\[<]+/, ""))) return null;
	token = token.replace(/^[`'"(\[<{]+/, "").replace(/[`'")\]>}.,;!?]+$/, "");
	const m = /^(.+?)(?::(\d+))?(?::\d+)?:?$/.exec(token);
	if (!m) return null;
	const path = m[1];
	if (!/^[\w.\-~@+/]+$/.test(path)) return null;
	const pathLike = path.includes("/") || /\.[A-Za-z0-9]+$/.test(path);
	if (!pathLike || /^\.+$/.test(path)) return null;
	return m[2] !== undefined ? { path, line: Number(m[2]) } : { path };
}
