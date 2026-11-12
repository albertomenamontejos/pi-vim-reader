// Wires the reader into Pi: alt+v shortcut, full-screen custom component and
// live session listeners. Pi objects are described structurally so this module
// stays importable (and testable) without Pi's runtime.

import type { OpenEffect } from "./actions.ts";
import { normalizeKey } from "./keys.ts";
import type { PaintStyle } from "./paint.ts";
import { ReaderView } from "./view.ts";

export interface TuiLike {
	terminal: { rows: number; columns: number; write?(data: string): void };
	requestRender(force?: boolean): void;
}

export interface ReaderContext {
	mode?: string;
	cwd: string;
	sessionManager: { getBranch(): unknown[] };
	ui: {
		custom<T>(
			factory: (tui: any, theme: any, keybindings: any, done: (result: T) => void) => unknown,
			options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> },
		): Promise<T>;
	};
}

export interface PiLike {
	registerShortcut(key: any, options: { description?: string; handler: (ctx: any) => Promise<void> | void }): void;
	on(event: any, handler: (event: any, ctx: any) => unknown): () => void;
}

export interface ReaderServices {
	copy(text: string, tui: TuiLike): Promise<void>;
	open(effect: OpenEffect, ctx: ReaderContext): Promise<string>;
	normalize?(data: string): string[];
	style?(theme: unknown): { paint?: PaintStyle; status?: (text: string) => string };
	now?(): number;
	setTimer?(fn: () => void, ms: number): () => void;
	throttleMs?: number;
}

export const SHORTCUT = "alt+v";

/** Overlay geometry: the whole terminal, like Gentle Shell's own changes overlay. */
export const OVERLAY_OPTIONS = { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } as const;

const defaultSetTimer = (fn: () => void, ms: number): (() => void) => {
	const t = setTimeout(fn, ms);
	return () => clearTimeout(t);
};

export function registerVimReader(pi: PiLike, services: ReaderServices): void {
	let open = false;

	pi.registerShortcut(SHORTCUT, {
		description: "Open the vim reader over the conversation",
		handler: async (ctx: ReaderContext) => {
			if (open) return;
			if (ctx.mode !== undefined && ctx.mode !== "tui") return;
			open = true;
			const unsubscribers: Array<() => void> = [];
			let view: ReaderView | undefined;
			const cleanup = () => {
				for (const off of unsubscribers.splice(0)) {
					try {
						off();
					} catch {
						/* never break close */
					}
				}
				view?.dispose();
			};
			try {
				await ctx.ui.custom<void>(
					(tui: TuiLike, theme: unknown, _keybindings: unknown, done: (result: void) => void) => {
						let closed = false;
						const close = () => {
							if (closed) return;
							closed = true;
							cleanup();
							done(undefined);
							// Force a full repaint so the fullscreen overlay leaves no stale cells.
							try {
								tui.requestRender(true);
							} catch {
								/* best effort */
							}
						};
						const styles = services.style?.(theme) ?? {};
						view = new ReaderView({
							rows: () => tui.terminal.rows,
							columns: () => tui.terminal.columns,
							getEntries: () => ctx.sessionManager.getBranch(),
							requestRender: () => tui.requestRender(),
							close,
							normalize: services.normalize ?? ((d) => normalizeKey(d)),
							copy: (text) => services.copy(text, tui),
							open: (effect) => services.open(effect, ctx),
							style: styles.paint,
							statusStyle: styles.status,
							now: services.now ?? Date.now,
							setTimer: services.setTimer ?? defaultSetTimer,
							throttleMs: services.throttleMs ?? 50,
						});
						const live = view;
						unsubscribers.push(
							pi.on("message_update", (e) => live.update("update", e?.message)),
							pi.on("message_end", (e) => live.update("end", e?.message)),
							pi.on("turn_end", () => live.update("settle")),
							pi.on("agent_end", () => live.update("settle")),
						);
						return live;
					},
					{ overlay: true, overlayOptions: { ...OVERLAY_OPTIONS } },
				);
			} finally {
				cleanup();
				open = false;
			}
		},
	});
}
