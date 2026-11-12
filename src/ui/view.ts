// The reader component: owns core state, rebuilds the transcript, paints rows.
// No Pi imports — it satisfies pi-tui's Component interface structurally.

import { createReader, handleKey, jumpTo, setHeight, setLines, visibleSlice } from "../core/index.ts";
import type { Effect, ReaderState } from "../core/index.ts";
import { buildTranscript } from "../transcript/transcript.ts";
import { formatStatus, paintRows } from "./paint.ts";
import type { PaintStyle } from "./paint.ts";
import type { OpenEffect } from "./actions.ts";
import { copyMessage } from "./actions.ts";
import type { Measure, StyledTranscript } from "./styled.ts";

export interface ReaderViewDeps {
	rows(): number;
	columns(): number;
	getEntries(): unknown[];
	/** Runs at the start of every render (the controller re-measures the chat region there). */
	beforeRender?(): void;
	/** Buffer row at the top of the chat's viewport when it is scrolled up; null/absent starts on the last line, following. */
	startRow?(lineCount: number): number | null;
	/** Styled chat lines (the chat's own rendering); null or a throw falls back to the plain transcript. */
	getStyled?(width: number): StyledTranscript | null;
	/** Grapheme width for styled rows. */
	measure?: Measure;
	/** ctrl+o: toggle the chat block that owns `child` (chat child index, undefined on the plain fallback); returns the status message. */
	toggleExpand?(child: number | undefined): string;
	requestRender(): void;
	close(): void;
	normalize(data: string): string[];
	copy(text: string): Promise<void>;
	open(effect: OpenEffect): Promise<string>;
	style?: PaintStyle;
	statusStyle?(text: string): string;
	now(): number;
	setTimer(fn: () => void, ms: number): () => void;
	throttleMs: number;
}

export type UpdateKind = "update" | "end" | "settle";

export class ReaderView {
	readonly capturesViewportInput = true;
	private state: ReaderState;
	private width: number;
	private streaming: unknown = undefined;
	private message = "";
	private lastStreamBuild = Number.NEGATIVE_INFINITY;
	private cancelTimer: (() => void) | null = null;
	private disposed = false;
	/** Styled line per buffer row while the styled source is active; null on the plain fallback. */
	private styled: readonly string[] | null = null;
	/** Chat child index per buffer row while the styled source is active. */
	private childOf: readonly number[] | null = null;
	private readonly deps: ReaderViewDeps;

	constructor(deps: ReaderViewDeps) {
		this.deps = deps;
		this.width = Math.max(1, deps.columns());
		const t = this.build();
		const start = this.styled !== null ? (this.deps.startRow?.(t.lines.length) ?? null) : null;
		this.state =
			start === null
				? createReader(t.lines, { meta: t.meta, height: this.contentHeight(), follow: true })
				: createReader(t.lines, { meta: t.meta, height: this.contentHeight(), follow: false, start });
	}

	get readerState(): ReaderState {
		return this.state;
	}

	private contentHeight(): number {
		return Math.max(1, this.deps.rows() - 1);
	}

	private build(streaming?: unknown): { lines: string[]; meta: number[] } {
		if (this.deps.getStyled) {
			try {
				// The chat already shows the streaming message, so `streaming` is not needed here.
				const t = this.deps.getStyled(this.width);
				if (t && t.lines.length > 0) {
					this.styled = t.styled;
					this.childOf = t.child;
					return t;
				}
			} catch {
				/* fall back to the plain transcript */
			}
		}
		this.styled = null;
		this.childOf = null;
		return buildTranscript(this.deps.getEntries(), { width: this.width, streaming });
	}

	private rebuild(streaming: unknown = this.streaming): void {
		const t = this.build(streaming);
		// Unchanged content keeps the cursor exactly where it is (setLines re-pins followers to col 0).
		if (sameLines(this.state.lines, t.lines) && sameLines(this.state.lineMeta, t.meta)) return;
		this.state = setLines(this.state, t.lines, t.meta);
	}

	/** Live session events (S4). */
	update(kind: UpdateKind, message?: unknown): void {
		if (this.disposed) return;
		if (kind === "update") {
			this.streaming = message;
			const wait = this.lastStreamBuild + this.deps.throttleMs - this.deps.now();
			if (wait <= 0) this.flushStream();
			else if (!this.cancelTimer) this.cancelTimer = this.deps.setTimer(() => this.flushStream(), wait);
			return;
		}
		this.cancelPending();
		this.streaming = undefined;
		// message_end fires before Pi persists the entry: include it once; transcript de-dups.
		this.rebuild(kind === "end" ? message : undefined);
		this.deps.requestRender();
	}

	private flushStream(): void {
		this.cancelTimer = null;
		if (this.disposed) return;
		this.lastStreamBuild = this.deps.now();
		this.rebuild();
		this.deps.requestRender();
	}

	private cancelPending(): void {
		this.cancelTimer?.();
		this.cancelTimer = null;
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		for (const key of this.deps.normalize(data)) {
			this.message = "";
			const result = handleKey(this.state, key);
			this.state = result.state;
			if (result.effect) this.apply(result.effect);
			if (this.disposed) return;
		}
		this.deps.requestRender();
	}

	private apply(effect: Effect): void {
		switch (effect.type) {
			case "close":
				this.deps.close();
				return;
			case "message":
				this.message = effect.text;
				return;
			case "toggle-expand": {
				const child = this.childOf?.[effect.row];
				const first = child === undefined ? -1 : (this.childOf?.indexOf(child) ?? -1);
				const text = this.deps.toggleExpand ? this.deps.toggleExpand(child) : "Nothing to expand";
				if (first >= 0) {
					// The block's own lines above it do not move: re-read the chat and keep the cursor on its first line.
					this.rebuild();
					if (!this.state.following) this.state = jumpTo(this.state, first);
				}
				this.flash(text);
				return;
			}
			case "copy": {
				const text = effect.text;
				this.deps.copy(text).then(
					() => this.flash(copyMessage(text)),
					(error: unknown) => this.flash(`Copy failed: ${error instanceof Error ? error.message : String(error)}`),
				);
				return;
			}
			case "open-url":
			case "open-file":
				this.deps.open(effect).then(
					(text) => this.flash(text),
					(error: unknown) => this.flash(`Open failed: ${error instanceof Error ? error.message : String(error)}`),
				);
				return;
		}
	}

	private flash(text: string): void {
		if (this.disposed) return;
		this.message = text;
		this.deps.requestRender();
	}

	render(width: number): string[] {
		this.deps.beforeRender?.();
		width = Math.max(1, Math.floor(width));
		if (width !== this.width) {
			this.width = width;
			this.rebuild();
		} else if (this.styled !== null) {
			// Styled source: re-read the chat on every frame so tool output and streaming show live.
			this.rebuild();
		}
		const height = this.contentHeight();
		if (height !== this.state.height) this.state = setHeight(this.state, height);
		const s = this.state;
		const rows = paintRows(visibleSlice(s), {
			width,
			height,
			style: this.deps.style,
			styled: this.styled ?? undefined,
			measure: this.deps.measure,
		});
		const status = formatStatus(
			{
				mode: s.mode,
				searchForward: s.searchForward,
				searchInput: s.searchInput,
				following: s.following,
				row: s.cursor.row,
				total: s.lines.length,
				message: this.message,
			},
			width,
		);
		rows.push(this.deps.statusStyle ? this.deps.statusStyle(status) : status);
		return rows;
	}

	invalidate(): void {}

	dispose(): void {
		this.disposed = true;
		this.cancelPending();
	}
}

function sameLines<T>(a: readonly T[], b: readonly T[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
