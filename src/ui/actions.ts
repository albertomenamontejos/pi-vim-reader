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

export interface OpenDeps {
	cwd: string;
	platform: string;
	exists(path: string): boolean;
	/** Launch a detached opener; rejects when the command cannot be started. */
	spawn(command: string, args: string[]): Promise<void>;
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
		target = isAbsolute(effect.path) ? effect.path : resolve(deps.cwd, effect.path);
		if (!deps.exists(target)) return `File not found: ${effect.path}`;
		label = effect.line === undefined ? target : `${target}:${effect.line}`;
	}
	const { command, args } = openCommand(deps.platform, target);
	try {
		await deps.spawn(command, args);
		return `Opened ${label}`;
	} catch (error) {
		return `Open failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}
