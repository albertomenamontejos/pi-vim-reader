// Wires the reader into Pi: alt+v shortcut, chat-region overlay component and
// live session listeners. Pi objects are described structurally so this module
// stays importable (and testable) without Pi's runtime.

import type { OpenEffect } from "./actions.ts";
import { normalizeKey } from "./keys.ts";
import type { PaintStyle } from "./paint.ts";
import { applyMargin, chatRegion, chatScroll, fullScreen, scrollStart } from "./geometry.ts";
import { COMMAND_NAME } from "./keymap.ts";
import { KeymapRefusal, parseArgs } from "./keymap.ts";
import type { Binding, Edit } from "./keymap.ts";
import { createStyledSource, findChatContainer, toggleBlock } from "./styled.ts";
import type { Measure } from "./styled.ts";
import { ReaderView } from "./view.ts";

export interface TuiLike {
	terminal: { rows: number; columns: number; write?(data: string): void };
	requestRender(force?: boolean): void;
	/** Pi's mounted components; read defensively to find the chat (see styled.ts). */
	children?: unknown[];
	/** Suspend and resume the terminal UI around a foreground program (pi-tui). */
	stop?(): void;
	start?(): void;
}

export interface ReaderContext {
	mode?: string;
	cwd: string;
	sessionManager: { getBranch(): unknown[] };
	ui: {
		/** Pi's public, global tool-output toggle (what ctrl+o does in the chat). */
		getToolsExpanded?(): boolean;
		setToolsExpanded?(expanded: boolean): void;
		custom<T>(
			factory: (tui: any, theme: any, keybindings: any, done: (result: T) => void) => unknown,
			options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> },
		): Promise<T>;
	};
}

export interface PiLike {
	registerShortcut(key: any, options: { description?: string; handler: (ctx: any) => Promise<void> | void }): void;
	/** Optional: hosts without slash commands only get the shortcut. */
	registerCommand?(name: string, options: { description?: string; handler: (args: string, ctx: any) => Promise<void> }): void;
	on(event: any, handler: (event: any, ctx: any) => unknown): () => void;
}

export interface ReaderServices {
	copy(text: string, tui: TuiLike): Promise<void>;
	open(effect: OpenEffect, ctx: ReaderContext, tui: TuiLike): Promise<string>;
	normalize?(data: string): string[];
	style?(theme: unknown): { paint?: PaintStyle; status?: (text: string) => string };
	now?(): number;
	setTimer?(fn: () => void, ms: number): () => void;
	throttleMs?: number;
	/** Grapheme width for styled rows (pi-tui visibleWidth). */
	measure?: Measure;
	/** `/vim-reader bind|unbind|reset`: edit the key binding in keymaps.json; returns the message, throws on failure. */
	editKeymap?(edit: Edit): string;
	/** What the user bound to `/vim-reader` in keymaps.json; absent or throwing keeps the default alt+v. */
	keymapBinding?(): Binding;
	/** Set false to always use the plain transcript instead of the chat's own styled lines. */
	styled?: boolean;
}

export const SHORTCUT = "alt+v";

/** Initial overlay options: the whole terminal. The chat-region margins are written into this object in place once the TUI is known. */
export const OVERLAY_OPTIONS = { width: "100%", maxHeight: "100%", margin: { top: 0, right: 0, bottom: 0, left: 0 }, anchor: "top-left" } as const;

const defaultSetTimer = (fn: () => void, ms: number): (() => void) => {
	const t = setTimeout(fn, ms);
	return () => clearTimeout(t);
};

export function registerVimReader(pi: PiLike, services: ReaderServices): void {
	let open = false;

	const openReader = async (ctx: ReaderContext): Promise<void> => {
		if (open) return;
		if (ctx.mode !== undefined && ctx.mode !== "tui") return;
		open = true;
		// pi-tui keeps this object by reference and re-resolves it every frame: margins are updated in place.
		const overlayOptions: Record<string, any> = { ...OVERLAY_OPTIONS, margin: { ...OVERLAY_OPTIONS.margin } };
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
					// Cover only the chat: header, rail, prompt and status bar stay visible.
					const measure = () => {
						try {
							return chatRegion(tui);
						} catch {
							return fullScreen(tui.terminal);
						}
					};
					let region = measure();
					applyMargin(overlayOptions, region);
					view = new ReaderView({
						rows: () => region.rows,
						columns: () => region.columns,
						beforeRender: () => {
							region = measure();
							if (applyMargin(overlayOptions, region)) {
								try {
									tui.requestRender();
								} catch {
									/* best effort */
								}
							}
						},
						startRow: (count) => scrollStart(chatScroll(tui), count),
						getEntries: () => ctx.sessionManager.getBranch(),
						getStyled: services.styled === false ? undefined : createStyledSource(tui),
						measure: services.measure,
						requestRender: () => tui.requestRender(),
						toggleExpand: (child) => {
							// Per block, like a mouse click on it; otherwise Pi's global toggle.
							const state = child === undefined ? null : toggleBlock(findChatContainer(tui), child);
							if (state) {
								tui.requestRender();
								return state === "expanded" ? "Expanded block" : "Collapsed block";
							}
							const { getToolsExpanded, setToolsExpanded } = ctx.ui;
							if (typeof getToolsExpanded === "function" && typeof setToolsExpanded === "function") {
								const next = !getToolsExpanded.call(ctx.ui);
								setToolsExpanded.call(ctx.ui, next);
								return next ? "All tool output expanded" : "All tool output collapsed";
							}
							return "Nothing to expand";
						},
						close,
						normalize: services.normalize ?? ((d) => normalizeKey(d)),
						copy: (text) => services.copy(text, tui),
						open: (effect) => services.open(effect, ctx, tui),
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
				{ overlay: true, overlayOptions },
			);
		} finally {
			cleanup();
			open = false;
		}
	};

	// `/vim-reader` can be typed, and bound to a key through keymaps.json (`command:vim-reader`).
	if (typeof pi.registerCommand === "function") {
		pi.registerCommand(COMMAND_NAME, {
			description: "Open the vim reader over the conversation",
			handler: async (args: string, ctx: ReaderContext) => {
				const command = parseArgs(args);
				if (command.type === "open") return openReader(ctx);
				const notify = (text: string, level: "info" | "warning" | "error") => {
					try {
						(ctx.ui as { notify?(text: string, level: string): void }).notify?.(text, level);
					} catch {
						/* best effort */
					}
				};
				if (command.type === "invalid") return notify(command.message, "warning");
				if (!services.editKeymap) return notify("Changing the key is not available here.", "warning");
				try {
					notify(services.editKeymap(command), "info");
				} catch (error) {
					if (error instanceof KeymapRefusal) return notify(error.message, "warning");
					notify(`Could not change the key: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
			},
		});
	}

	// alt+v is only the default: a key assigned or disabled in keymaps.json replaces it.
	let binding: Binding = { state: "default" };
	try {
		binding = services.keymapBinding?.() ?? binding;
	} catch {
		/* unreadable keymaps: keep the default key */
	}
	if (binding.state === "default" || typeof pi.registerCommand !== "function") {
		pi.registerShortcut(SHORTCUT, {
			description: "Open the vim reader over the conversation",
			handler: openReader,
		});
	}
}
