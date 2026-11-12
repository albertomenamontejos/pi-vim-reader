// Rebindable open key: the reader registers the slash command `/vim-reader`. Gentle
// Shell runs any `command:<name>` binding found in its `keymaps.json`
// ({ schema: 1, bindings }); the Customize -> Keymaps menu only lists commands from
// its own catalog, so `/vim-reader bind <key>` writes the binding to that file itself.
// This module only reads that file, defensively, to decide whether the built-in
// default key (alt+v) should still be registered. Pure: I/O is injected.

import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const COMMAND_NAME = "vim-reader";
/** Gentle Shell's keymap id for a palette command: `command:<name>`. */
export const COMMAND_ID = `command:${COMMAND_NAME}`;

export type Binding = { state: "default" } | { state: "assigned"; key: string } | { state: "disabled" };

type Env = Record<string, string | undefined>;

const KEYMAPS_FILE = "keymaps.json";
const KEYMAPS_SCHEMA = 1;

/**
 * Gentle Shell's config home candidates, in its own resolution order: a bundled
 * prefix's `config/gentle-ai`, an explicit GENTLE_PI_CONFIG_HOME, the launcher's
 * GENTLE_SHELL_CONFIG_HOME marker (absolute only), then `~/.pi/gentle-ai`.
 * Empty values count as unset.
 */
export function configHomeCandidates(env: Env, home: string): string[] {
	const out: string[] = [];
	const prefix = env.GENTLE_SHELL_PREFIX;
	if (prefix && isAbsolute(prefix)) out.push(join(prefix, "config", "gentle-ai"));
	if (env.GENTLE_PI_CONFIG_HOME) out.push(env.GENTLE_PI_CONFIG_HOME);
	const marker = env.GENTLE_SHELL_CONFIG_HOME;
	if (marker && isAbsolute(marker)) out.push(marker);
	out.push(join(home, ".pi", "gentle-ai"));
	return out;
}

/** Gentle Shell reads exactly one config home: the first applicable candidate. */
export function configHome(env: Env, home: string): string {
	return configHomeCandidates(env, home)[0]!;
}

const MODIFIER_ORDER = ["ctrl", "shift", "alt", "super"];

/** Lowercase and order modifiers as ctrl, shift, alt, super; undefined for an unknown modifier (Gentle Shell's rule). */
export function normalizeKeyId(key: string): string | undefined {
	const parts = key.trim().toLowerCase().split("+");
	const base = parts.pop();
	if (!base) return undefined;
	const modifiers = new Set<string>();
	for (const part of parts) {
		if (!MODIFIER_ORDER.includes(part)) return undefined;
		modifiers.add(part);
	}
	return [...MODIFIER_ORDER.filter((m) => modifiers.has(m)), base].join("+");
}

type Bindings = Record<string, string | null>;

/** Strict like Gentle Shell: any invalid entry makes the whole file malformed (it then registers nothing). */
function parseKeymapFile(raw: string): Bindings | undefined {
	try {
		const value = JSON.parse(raw) as { schema?: unknown; bindings?: unknown };
		const bindings = value?.bindings;
		if (value?.schema !== KEYMAPS_SCHEMA || typeof bindings !== "object" || bindings === null || Array.isArray(bindings)) return undefined;
		const out: Bindings = {};
		for (const [id, key] of Object.entries(bindings)) {
			if (id === "" || (key !== null && (typeof key !== "string" || normalizeKeyId(key) === undefined))) return undefined;
			out[id] = key as string | null;
		}
		return out;
	} catch {
		return undefined;
	}
}

/**
 * What the user bound to the open-reader command in keymaps.json (read from the
 * single config home). A missing, malformed or wrong-schema file means the default key.
 */
export function commandBinding(home: string, readFile: (path: string) => string | undefined): Binding {
	let raw: string | undefined;
	try {
		raw = readFile(join(home, KEYMAPS_FILE));
	} catch {
		return { state: "default" };
	}
	if (raw === undefined) return { state: "default" };
	const bindings = parseKeymapFile(raw);
	const key = bindings?.[COMMAND_ID];
	if (key === null) return { state: "disabled" };
	if (typeof key === "string" && key !== "") return { state: "assigned", key };
	return { state: "default" };
}

export const USAGE = "Usage: /vim-reader [bind <key> | unbind | reset]. Keys: a ctrl, alt or super combination, or f1-f12 (for example alt+r).";

export type Edit = { type: "bind"; key: string } | { type: "unbind" } | { type: "reset" };
export type Command = { type: "open" } | Edit | { type: "invalid"; message: string };

/** `/vim-reader` arguments: nothing opens the reader; bind, unbind and reset edit the key binding. */
export function parseArgs(args: string): Command {
	const words = args.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return { type: "open" };
	const verb = words[0]!.toLowerCase();
	if (verb === "bind" && words.length === 2) return { type: "bind", key: words[1]! };
	if (verb === "unbind" && words.length === 1) return { type: "unbind" };
	if (verb === "reset" && words.length === 1) return { type: "reset" };
	return { type: "invalid", message: USAGE };
}

/** Snapshot of Gentle Shell's default keys (lib/keymaps.ts KEYMAP_ACTIONS), only used to refuse obvious clashes. */
const GENTLE_DEFAULTS: ReadonlyArray<readonly [id: string, label: string, key: string]> = [
	["commands", "Command palette", "alt+k"],
	["changes", "Browse changes", "alt+g"],
	["usage", "Subscription usage", "alt+u"],
	["preset", "Cycle visual preset", "alt+l"],
	["agents.view", "Subagents overlay", "alt+a"],
	["agents.stop", "Stop active subagents", "alt+s"],
	["agents.collapse", "Collapse the agents card", "ctrl+shift+a"],
	["jobs.collapse", "Collapse the jobs card", "ctrl+shift+j"],
	["todo.collapse", "Collapse the todo list", "ctrl+shift+t"],
];

const DEFAULT_KEY = "alt+v";

/** A refused edit (bad key, clash, malformed file): the user's input or file is at fault, not the system. */
export class KeymapRefusal extends Error {}

/** Pi's default non-overridable keys (gentle-pi RESERVED_PI_KEYBINDINGS): Pi skips an extension shortcut on them. */
const PI_RESERVED = new Set(["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+l", "ctrl+o", "ctrl+k", "ctrl+g", "ctrl+t", "ctrl+p", "ctrl+shift+p", "alt+enter"]);

const NAMED_KEYS = new Set(["enter", "tab", "escape", "space", "backspace", "delete", "insert", "home", "end", "pageup", "pagedown", "up", "down", "left", "right"]);

/** A base key a terminal can send: one character, a named key, or f1-f12. */
function validBase(base: string): boolean {
	return [...base].length === 1 || NAMED_KEYS.has(base) || /^f([1-9]|1[0-2])$/.test(base);
}

export type EditResult = { ok: true; text: string; message: string } | { ok: false; message: string };

function serialize(bindings: Bindings): string {
	return `${JSON.stringify({ schema: KEYMAPS_SCHEMA, bindings }, null, "\t")}\n`;
}

/**
 * Apply one edit to the raw keymaps.json text (undefined when the file does not
 * exist). Pure. Never rewrites a malformed file; keeps every other binding.
 */
export function applyEdit(raw: string | undefined, edit: Edit): EditResult {
	let bindings: Bindings = {};
	if (raw !== undefined) {
		const parsed = parseKeymapFile(raw);
		if (!parsed) return { ok: false, message: "keymaps.json is unreadable or malformed; fix or delete it before changing the key." };
		bindings = parsed;
	}
	const next: Bindings = { ...bindings };
	if (edit.type === "unbind") {
		next[COMMAND_ID] = null;
		return { ok: true, text: serialize(next), message: "Key disabled for /vim-reader; type /vim-reader to open it. Run /reload to apply." };
	}
	if (edit.type === "reset") {
		delete next[COMMAND_ID];
		return { ok: true, text: serialize(next), message: `/vim-reader is back on its default key, ${DEFAULT_KEY}. Run /reload to apply.` };
	}
	const key = normalizeKeyId(edit.key);
	if (key === undefined) return { ok: false, message: `${edit.key} is not a valid key. ${USAGE}` };
	if (!validBase(key.split("+").pop()!)) return { ok: false, message: `${edit.key} is not a valid key. ${USAGE}` };
	const modifiers = key.split("+").slice(0, -1);
	const assignable = modifiers.some((m) => m !== "shift") || /^f([1-9]|1[0-2])$/.test(key);
	if (!assignable) return { ok: false, message: `${key} is needed for typing. Use a combination with ctrl, alt or super, or f1-f12.` };
	if (PI_RESERVED.has(key)) return { ok: false, message: `${key} is reserved by Pi; choose another key.` };
	for (const [id, key2] of Object.entries(bindings)) {
		if (id !== COMMAND_ID && key2 !== null && normalizeKeyId(key2) === key) return { ok: false, message: `${key} is already used by ${id} in keymaps.json.` };
	}
	for (const [id, label, defaultKey] of GENTLE_DEFAULTS) {
		if (defaultKey === key && !(id in bindings)) return { ok: false, message: `${key} is used by ${label}. Pick another key.` };
	}
	next[COMMAND_ID] = key;
	return { ok: true, text: serialize(next), message: `Saved ${key} for /vim-reader. Run /reload to apply.` };
}

/** Same-directory rename, so a reader never sees a partially written file. */
export function writeAtomic(path: string, text: string): void {
	const dir = join(path, "..");
	const temporary = `${path}.${randomUUID()}.tmp`;
	mkdirSync(dir, { recursive: true });
	try {
		writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try {
			unlinkSync(temporary);
		} catch {
			/* the rename already consumed it */
		}
	}
}

export interface KeymapIo {
	read(path: string): string | undefined;
	write(path: string, text: string): void;
}

/** Read keymaps.json from `home`, apply `edit`, write it back; returns the message, throws with the reason on failure. */
export function saveEdit(home: string, edit: Edit, io: KeymapIo): string {
	const path = join(home, KEYMAPS_FILE);
	const result = applyEdit(io.read(path), edit);
	if (!result.ok) throw new KeymapRefusal(result.message);
	io.write(path, result.text);
	return result.message;
}
