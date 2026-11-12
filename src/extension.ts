// Gentle Shell / Pi extension entry: alt+v opens a full-screen, read-only,
// vim-style reader over the whole conversation. Pi-dependent glue only; the
// testable logic lives in src/ui/** and src/core/**.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, parseKey, visibleWidth } from "@earendil-works/pi-tui";
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
			selection: (s) => (t.bg ? call(() => t.bg!("selectedBg", s), inverse(s)) : inverse(s)),
			match: (s) => (t.bg ? call(() => t.bg!("searchMatchBg", s), `\x1b[4m${s}\x1b[24m`) : `\x1b[4m${s}\x1b[24m`),
			filler: (s) => (t.fg ? call(() => t.fg!("dim", s), s) : s),
		},
		status: inverse,
	};
}

export default function vimReader(pi: ExtensionAPI): void {
	registerVimReader(pi, {
		copy,
		open: (effect, ctx) =>
			openEffect(effect, { cwd: ctx.cwd, platform: process.platform, exists: existsSync, spawn: launch }),
		normalize: (data) => normalizeKey(data, { decodePrintable: decodeKittyPrintable, parseKey }),
		style: themed,
		measure: visibleWidth,
	});
}
