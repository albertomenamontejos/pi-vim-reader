// Styled source: reads the conversation lines exactly as Pi's chat renders them
// (ANSI colors, boxes, Markdown, wrapping) so the reader looks like the chat.
//
// Pi has no public API for this. In Pi 1.5.2 InteractiveMode builds
// `documentContainer = [headerContainer, loadedResourcesContainer, chatContainer]`
// (interactive-mode.js:401-407) and mounts it as the first `tui.children` entry
// (interactive-mode.js:623-625, 723). Each `chatContainer.children` entry is one
// rendered block (message, tool execution, spacer, border). Everything here is
// defensive: any unknown shape returns `null` and the caller falls back to the
// plain transcript built from session entries.

export interface StyledTranscript {
	/** Plain text of each line (escape sequences and trailing padding stripped); core columns index into these. */
	lines: string[];
	/** The chat's own ANSI line, painted with highlights on top. */
	styled: string[];
	/** Chat child index per line; blank-only children (spacers) join the previous message. */
	meta: number[];
}

/** Width in terminal cells of one grapheme. */
export type Measure = (grapheme: string) => number;

export type Token = { kind: "esc"; text: string } | { kind: "text"; text: string; offset: number };

interface ComponentLike {
	render(width: number): string[];
}

interface ContainerLike extends ComponentLike {
	children: unknown[];
}

export const IMAGE_PLACEHOLDER = "[image]";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Length of the escape sequence at `pos` (0 when none): CSI, OSC/APC/DCS/PM/SOS strings, or a 2-char ESC. */
function escapeLength(str: string, pos: number): number {
	if (str.charCodeAt(pos) !== 0x1b) return 0;
	const next = str[pos + 1];
	if (next === undefined) return 1;
	if (next === "[") {
		for (let j = pos + 2; j < str.length; j++) {
			const c = str.charCodeAt(j);
			if (c >= 0x40 && c <= 0x7e) return j + 1 - pos;
		}
		return str.length - pos;
	}
	if (next === "]" || next === "_" || next === "P" || next === "^" || next === "X") {
		for (let j = pos + 2; j < str.length; j++) {
			const c = str.charCodeAt(j);
			if (c === 0x07) return j + 1 - pos;
			if (c === 0x1b && str[j + 1] === "\\") return j + 2 - pos;
		}
		return str.length - pos;
	}
	return 2;
}

/** Split a styled line into escape sequences and graphemes; text offsets are UTF-16 offsets into the plain text. */
export function tokenize(line: string): Token[] {
	const tokens: Token[] = [];
	let offset = 0;
	let i = 0;
	while (i < line.length) {
		const esc = escapeLength(line, i);
		if (esc > 0) {
			tokens.push({ kind: "esc", text: line.slice(i, i + esc) });
			i += esc;
			continue;
		}
		let end = line.indexOf("\x1b", i);
		if (end === -1) end = line.length;
		for (const { segment } of segmenter.segment(line.slice(i, end))) {
			tokens.push({ kind: "text", text: segment, offset });
			offset += segment.length;
		}
		i = end;
	}
	return tokens;
}

/** Visible text of a styled line. */
export function plainText(line: string): string {
	if (!line.includes("\x1b")) return line;
	let out = "";
	for (const t of tokenize(line)) if (t.kind === "text") out += t.text;
	return out;
}

/** Kitty / iTerm2 inline image rows (same test as pi-tui's isImageLine). */
export function isImageLine(line: string): boolean {
	return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

const isComponent = (v: unknown): v is ComponentLike =>
	typeof v === "object" && v !== null && typeof (v as ComponentLike).render === "function";

const isContainer = (v: unknown): v is ContainerLike => isComponent(v) && Array.isArray((v as ContainerLike).children);

/** Locate Pi's chatContainer inside `tui.children`, or undefined when the shape is unknown. */
export function findChatContainer(tui: unknown): ContainerLike | undefined {
	try {
		if (typeof tui !== "object" || tui === null) return undefined;
		const children = (tui as { children?: unknown }).children;
		if (!Array.isArray(children)) return undefined;
		for (const doc of children) {
			if (!isContainer(doc)) continue;
			const parts = doc.children;
			if (parts.length === 3 && parts.every(isContainer)) return parts[2] as ContainerLike;
		}
	} catch {
		/* unknown shape */
	}
	return undefined;
}

/** Render every chat child at `width` and derive plain lines and message meta. Throws if a child throws. */
export function buildStyledTranscript(
	chat: ContainerLike,
	width: number,
	plainOf: (line: string) => string = plainText,
): StyledTranscript {
	const lines: string[] = [];
	const styled: string[] = [];
	const meta: number[] = [];
	let message = -1;
	for (const child of [...chat.children]) {
		if (!isComponent(child)) continue;
		const rendered = child.render(width);
		if (!Array.isArray(rendered)) continue;
		const out: string[] = [];
		const plain: string[] = [];
		for (const raw of rendered) {
			const line = typeof raw === "string" ? raw : "";
			if (isImageLine(line)) {
				out.push(IMAGE_PLACEHOLDER);
				plain.push(IMAGE_PLACEHOLDER);
			} else {
				out.push(line);
				// Pi pads lines to the full width; trailing padding is not text (yy, $, search).
				plain.push(plainOf(line).trimEnd());
			}
		}
		if (out.length === 0) continue;
		if (message < 0 || plain.some((p) => p.trim() !== "")) message++;
		for (let i = 0; i < out.length; i++) {
			styled.push(out[i]!);
			lines.push(plain[i]!);
			meta.push(message);
		}
	}
	return { lines, styled, meta };
}

/**
 * A reusable styled source bound to `tui`. Returns null (use the plain transcript)
 * when the chat container is missing, renders nothing, or throws.
 * Plain conversions are cached between calls by styled line.
 */
export function createStyledSource(tui: unknown): (width: number) => StyledTranscript | null {
	let cache = new Map<string, string>();
	return (width) => {
		try {
			const chat = findChatContainer(tui);
			if (!chat) return null;
			const next = new Map<string, string>();
			const plainOf = (line: string): string => {
				let p = next.get(line) ?? cache.get(line);
				if (p === undefined) p = plainText(line);
				next.set(line, p);
				return p;
			};
			const t = buildStyledTranscript(chat, Math.max(1, Math.floor(width)), plainOf);
			cache = next;
			return t.lines.length > 0 ? t : null;
		} catch {
			return null;
		}
	};
}
