// Gentle Shell / Pi extension entry: alt+v (rebindable through keymaps.json, or /vim-reader) opens a read-only,
// vim-style reader over the whole conversation. Pi-dependent glue only; the
// testable logic lives in src/ui/** and src/core/**.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, parseKey, visibleWidth } from "@earendil-works/pi-tui";
import { commandBinding, configHome, saveEdit, writeAtomic } from "./ui/keymap.ts";
import { openEffect, osc52 } from "./ui/actions.ts";
import { registerVimReader } from "./ui/controller.ts";
import type { TuiLike } from "./ui/controller.ts";
import { normalizeKey } from "./ui/keys.ts";
import type { PaintStyle } from "./ui/paint.ts";

type ThemeLike = {
	inverse?(text: string): string;
	underline?(text: string): string;
	bg?(color: string, text: string): string;
	fg?(color: string, text: string): string;
};

const copyToClipboard = (piCodingAgent as { copyToClipboard?: (text: string) => Promise<void> }).copyToClipboard;

async function copy(text: string, tui: TuiLike): Promise<void> {
	if (copyToClipboard) {
		try {
			// Native clipboard (wl-copy/xclip/pbcopy/…) plus OSC 52, as Pi's own copy does.
			await copyToClipboard(text);
			return;
		} catch {
			/* fall through to OSC 52 */
		}
	}
	if (!tui.terminal.write) throw new Error("no clipboard available");
	tui.terminal.write(osc52(text));
}

function launch(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

const readIfExists = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

function runEditor(tui: TuiLike, command: string, args: string[]): void {
	tui.stop!();
	try {
		const result = spawnSync(command, args, { stdio: "inherit", shell: false });
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(result.signal ? `terminated by ${result.signal}` : `exit status ${result.status}`);
	} finally {
		tui.start!();
		tui.requestRender(true);
	}
}

function themed(theme: unknown): { paint: PaintStyle; status: (text: string) => string } {
	const t = (theme ?? {}) as ThemeLike;
	const call = (fn: () => string, fallback: string): string => {
		try {
			return fn();
		} catch {
			return fallback;
		}
	};
	const inverse = (s: string) => (t.inverse ? call(() => t.inverse!(s), `\x1b[7m${s}\x1b[27m`) : `\x1b[7m${s}\x1b[27m`);
	return {
		paint: {
			cursor: inverse,
			// Muted champagne (Gentleman-Sexy's own gold) behind dark text; fixed so it reads the same on any theme.
			selection: (s) => `\x1b[48;2;224;194;122;38;5;16m${s}\x1b[49;39m`,
			match: (s) => (t.bg ? call(() => t.bg!("searchMatchBg", s), `\x1b[4m${s}\x1b[24m`) : `\x1b[4m${s}\x1b[24m`),
			filler: (s) => (t.fg ? call(() => t.fg!("dim", s), s) : s),
		},
		status: (s) => s, // transparent: no background, terminal default colors
	};
}

export default function vimReader(pi: ExtensionAPI): void {
	registerVimReader(pi, {
		copy,
		open: (effect, ctx, tui) =>
			openEffect(effect, {
				cwd: ctx.cwd,
				platform: process.platform,
				exists: existsSync,
				spawn: launch,
				home: homedir(),
				editor: process.env.VISUAL || process.env.EDITOR,
				// Same dance as Gentle Shell's own external editor: stop the TUI, run in the foreground, resume.
				edit: tui.stop && tui.start ? (command, args) => runEditor(tui, command, args) : undefined,
			}),
		normalize: (data) => normalizeKey(data, { decodePrintable: decodeKittyPrintable, parseKey }),
		keymapBinding: () => commandBinding(configHome(process.env, homedir()), readIfExists),
		editKeymap: (edit) => saveEdit(configHome(process.env, homedir()), edit, { read: readIfExists, write: writeAtomic }),
		style: themed,
		measure: visibleWidth,
	});
}
