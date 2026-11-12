// Side effects requested by the core (copy / open), with I/O injected.

import { isAbsolute, resolve } from "node:path";
import type { Effect } from "../core/index.ts";

export function copyMessage(text: string): string {
	const n = text.split("\n").length;
	return `Copied ${n} line${n === 1 ? "" : "s"}`;
}

/** OSC 52 clipboard write sequence (terminal-side clipboard fallback). */
export function osc52(text: string): string {
	return `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;
}

export function openCommand(platform: string, target: string): { command: string; args: string[] } {
	if (platform === "darwin") return { command: "open", args: [target] };
	if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", target] };
	return { command: "xdg-open", args: [target] };
}

/** `$VISUAL`/`$EDITOR` split into command and args, with `+line` before the path; null when unset or blank. */
export function editorCommand(editor: string | undefined, path: string, line?: number): { command: string; args: string[] } | null {
	const [command, ...args] = (editor ?? "").trim().split(/\s+/).filter(Boolean);
	if (!command) return null;
	return { command, args: [...args, ...(line === undefined ? [] : [`+${line}`]), path] };
}

export interface OpenDeps {
	cwd: string;
	platform: string;
	exists(path: string): boolean;
	/** Launch a detached opener; rejects when the command cannot be started. */
	spawn(command: string, args: string[]): Promise<void>;
	/** Home directory used to expand `~` and `~/` in gf paths. */
	home?: string;
	/** `$VISUAL` or `$EDITOR`; with `edit`, gf opens files there instead of the desktop opener. */
	editor?: string;
	/** Run the editor in the foreground, suspending the TUI until it exits; throws on failure. */
	edit?(command: string, args: string[]): void;
}

export type OpenEffect = Extract<Effect, { type: "open-url" } | { type: "open-file" }>;

/** Perform gx / gf and return the status message. Never throws. */
export async function openEffect(effect: OpenEffect, deps: OpenDeps): Promise<string> {
	let target: string;
	let label: string;
	if (effect.type === "open-url") {
		target = effect.url;
		label = effect.url;
	} else {
		const p = effect.path;
		if (p.startsWith("~") && !(p === "~" || p.startsWith("~/"))) return `File not found: ${p}`;
		if (p.startsWith("~")) {
			// A tilde path is never relative to cwd: expand it, or report it missing.
			if (!deps.home) return `File not found: ${p}`;
			target = resolve(deps.home, p.slice(2));
		} else {
			target = isAbsolute(p) ? p : resolve(deps.cwd, p);
		}
		if (!deps.exists(target)) return `File not found: ${effect.path}`;
		label = effect.line === undefined ? target : `${target}:${effect.line}`;
	}
	if (effect.type === "open-file" && deps.edit) {
		const editor = editorCommand(deps.editor, target, effect.line);
		if (editor) {
			try {
				deps.edit(editor.command, editor.args);
				return `Edited ${label} in ${editor.command}`;
			} catch (error) {
				return `Open failed: ${error instanceof Error ? error.message : String(error)}`;
			}
		}
	}
	const { command, args } = openCommand(deps.platform, target);
	try {
		await deps.spawn(command, args);
		return `Opened ${label}`;
	} catch (error) {
		return `Open failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}
