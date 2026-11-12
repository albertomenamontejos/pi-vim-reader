import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdit, commandBinding, configHome, KeymapRefusal, configHomeCandidates, COMMAND_ID, COMMAND_NAME, normalizeKeyId, parseArgs, saveEdit, writeAtomic } from "../../src/ui/keymap.ts";

test("S15 keymap: command id matches Gentle Shell's `command:<name>` convention", () => {
	assert.equal(COMMAND_NAME, "vim-reader");
	assert.equal(COMMAND_ID, "command:vim-reader");
});

test("S15 keymap: config home candidates follow Gentle Shell's order, ignoring empty or relative values", () => {
	const env = { GENTLE_SHELL_PREFIX: "/g", GENTLE_PI_CONFIG_HOME: "/cfg", GENTLE_SHELL_CONFIG_HOME: "/marker" };
	assert.deepEqual(configHomeCandidates(env, "/home/u"), ["/g/config/gentle-ai", "/cfg", "/marker", "/home/u/.pi/gentle-ai"]);
	assert.deepEqual(configHomeCandidates({}, "/home/u"), ["/home/u/.pi/gentle-ai"]);
	assert.deepEqual(configHomeCandidates({ GENTLE_SHELL_PREFIX: "rel", GENTLE_PI_CONFIG_HOME: "", GENTLE_SHELL_CONFIG_HOME: "rel" }, "/home/u"), ["/home/u/.pi/gentle-ai"]);
});

const file = (bindings: Record<string, string | null>, schema: unknown = 1) => JSON.stringify({ schema, bindings });
const reader = (files: Record<string, string>) => (path: string): string | undefined => files[path];

test("S15 keymap: Gentle Shell's single config home is the first candidate", () => {
	assert.equal(configHome({ GENTLE_SHELL_PREFIX: "/g", GENTLE_PI_CONFIG_HOME: "/cfg" }, "/home/u"), "/g/config/gentle-ai");
	assert.equal(configHome({}, "/home/u"), "/home/u/.pi/gentle-ai");
});

test("S15 keymap: no file, other ids only, malformed or wrong-schema files mean the default key", () => {
	assert.deepEqual(commandBinding("/a", reader({})), { state: "default" });
	assert.deepEqual(commandBinding("/a", reader({ "/a/keymaps.json": file({ "command:other": "alt+x" }) })), { state: "default" });
	assert.deepEqual(commandBinding("/a", reader({ "/a/keymaps.json": "{ nope" })), { state: "default" });
	assert.deepEqual(commandBinding("/a", reader({ "/a/keymaps.json": file({ [COMMAND_ID]: "alt+x" }, 2) })), { state: "default" });
	assert.deepEqual(commandBinding("/a", reader({ "/a/keymaps.json": file({ [COMMAND_ID]: 5 as any }) })), { state: "default" });
	assert.deepEqual(
		commandBinding("/a", reader({ "/a/keymaps.json": file({ [COMMAND_ID]: "alt+x", other: "not a key+" }) })),
		{ state: "default" },
		"Gentle Shell treats the whole file as malformed when any key is invalid, so it registers nothing",
	);
});

test("S15 keymap: a saved key is assigned and null is disabled; other homes are never read", () => {
	assert.deepEqual(commandBinding("/b", reader({ "/b/keymaps.json": file({ [COMMAND_ID]: "ctrl+alt+r" }) })), { state: "assigned", key: "ctrl+alt+r" });
	assert.deepEqual(commandBinding("/a", reader({ "/a/keymaps.json": file({ [COMMAND_ID]: null }) })), { state: "disabled" });
	assert.deepEqual(commandBinding("/a", reader({ "/b/keymaps.json": file({ [COMMAND_ID]: "alt+z" }) })), { state: "default" });
});

test("S16 keymap: normalizeKeyId lowercases and orders modifiers like Gentle Shell", () => {
	assert.equal(normalizeKeyId("Alt+Ctrl+R"), "ctrl+alt+r");
	assert.equal(normalizeKeyId("super+shift+f5"), "shift+super+f5");
	assert.equal(normalizeKeyId("hyper+r"), undefined);
	assert.equal(normalizeKeyId(""), undefined);
	assert.equal(normalizeKeyId("alt+"), undefined);
});

test("S16 keymap: parseArgs reads /vim-reader, bind <key>, unbind, reset and rejects the rest with usage", () => {
	assert.deepEqual(parseArgs(""), { type: "open" });
	assert.deepEqual(parseArgs("   "), { type: "open" });
	assert.deepEqual(parseArgs("bind alt+r"), { type: "bind", key: "alt+r" });
	assert.deepEqual(parseArgs("  BIND  Ctrl+Alt+R "), { type: "bind", key: "Ctrl+Alt+R" });
	assert.deepEqual(parseArgs("unbind"), { type: "unbind" });
	assert.deepEqual(parseArgs("reset"), { type: "reset" });
	for (const bad of ["bind", "bind a b", "unbind now", "frobnicate", "alt+r"]) {
		const r = parseArgs(bad);
		assert.equal(r.type, "invalid", bad);
		assert.match((r as any).message, /Usage: \/vim-reader \[bind <key> \| unbind \| reset\]/);
	}
});

const parse = (text: string) => JSON.parse(text);

test("S16 keymap: bind saves the normalized key, keeps every other binding, and says to /reload", () => {
	const raw = JSON.stringify({ schema: 1, bindings: { "stats.view": "ctrl+alt+0" } });
	const r = applyEdit(raw, { type: "bind", key: "Alt+R" });
	assert.ok(r.ok);
	assert.deepEqual(parse(r.text), { schema: 1, bindings: { "stats.view": "ctrl+alt+0", [COMMAND_ID]: "alt+r" } });
	assert.match(r.message, /alt\+r/);
	assert.match(r.message, /\/reload/);
	const fresh = applyEdit(undefined, { type: "bind", key: "alt+r" });
	assert.ok(fresh.ok);
	assert.deepEqual(parse(fresh.text), { schema: 1, bindings: { [COMMAND_ID]: "alt+r" } });
});

test("S16 keymap: bind refuses keys that would break typing, unknown modifiers and keys already in use", () => {
	const refuse = (raw: string | undefined, key: string, re: RegExp) => {
		const r = applyEdit(raw, { type: "bind", key });
		assert.equal(r.ok, false, key);
		assert.match((r as any).message, re, key);
	};
	refuse(undefined, "r", /needed for typing/);
	refuse(undefined, "shift+r", /needed for typing/);
	refuse(undefined, "enter", /needed for typing/);
	refuse(undefined, "hyper+r", /not a valid key/i);
	refuse(undefined, "alt+k", /Command palette/);
	refuse(JSON.stringify({ schema: 1, bindings: { "stats.view": "alt+r" } }), "ALT+R", /stats\.view/);
	assert.ok(applyEdit(undefined, { type: "bind", key: "f5" }).ok);
	assert.ok(applyEdit(undefined, { type: "bind", key: "ctrl+shift+r" }).ok);
	assert.ok(applyEdit(JSON.stringify({ schema: 1, bindings: { commands: null } }), { type: "bind", key: "alt+k" }).ok, "a default the user moved away is free");
	assert.ok(applyEdit(JSON.stringify({ schema: 1, bindings: { [COMMAND_ID]: "alt+r" } }), { type: "bind", key: "alt+r" }).ok, "rebinding the same key is fine");
});

test("S16 keymap: unbind writes null, reset removes the entry, and a malformed file is never overwritten", () => {
	const u = applyEdit(undefined, { type: "unbind" });
	assert.ok(u.ok);
	assert.deepEqual(parse(u.text), { schema: 1, bindings: { [COMMAND_ID]: null } });
	const raw = JSON.stringify({ schema: 1, bindings: { [COMMAND_ID]: "alt+r", "stats.view": "ctrl+alt+0" } });
	const r = applyEdit(raw, { type: "reset" });
	assert.ok(r.ok);
	assert.deepEqual(parse(r.text), { schema: 1, bindings: { "stats.view": "ctrl+alt+0" } });
	assert.match(r.message, /alt\+v/);
	for (const bad of ["{ nope", JSON.stringify({ schema: 2, bindings: {} }), JSON.stringify({ schema: 1, bindings: { x: "bad+" } })]) {
		const m = applyEdit(bad, { type: "bind", key: "alt+r" });
		assert.equal(m.ok, false);
		assert.match((m as any).message, /malformed|unreadable/i);
	}
});

test("S16 keymap: writeAtomic writes the file with 0600 and leaves no temporary file; saveEdit round-trips in a temp home", () => {
	const dir = mkdtempSync(join(tmpdir(), "vim-reader-keymap-"));
	try {
		const home = join(dir, "config", "gentle-ai");
		const io = { read: (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined), write: writeAtomic };
		const msg = saveEdit(home, { type: "bind", key: "alt+r" }, io);
		assert.match(msg, /alt\+r/);
		const path = join(home, "keymaps.json");
		assert.deepEqual(parse(readFileSync(path, "utf8")), { schema: 1, bindings: { [COMMAND_ID]: "alt+r" } });
		assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.deepEqual(readdirSync(home), ["keymaps.json"]);
		assert.deepEqual(commandBinding(home, io.read), { state: "assigned", key: "alt+r" });
		writeFileSync(path, "{ nope");
		assert.throws(() => saveEdit(home, { type: "bind", key: "alt+t" }, io), /malformed|unreadable/i);
		assert.equal(readFileSync(path, "utf8"), "{ nope", "a malformed file is left untouched");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("S17 keymap: bind refuses keys Pi reserves (they would be skipped and leave no key at all)", () => {
	for (const key of ["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+l", "ctrl+o", "ctrl+k", "ctrl+g", "ctrl+t", "ctrl+p", "ctrl+shift+p", "alt+enter", "Ctrl+C"]) {
		const r = applyEdit(undefined, { type: "bind", key });
		assert.equal(r.ok, false, key);
		assert.match((r as any).message, /reserved by Pi/, key);
	}
	assert.ok(applyEdit(undefined, { type: "bind", key: "alt+r" }).ok);
});

test("S17 keymap: bind refuses keys the terminal could never send (unknown base)", () => {
	for (const key of ["alt+foo", "ctrl+alt+", "alt+ab", "ctrl+f13"]) {
		const r = applyEdit(undefined, { type: "bind", key });
		assert.equal(r.ok, false, key);
		assert.match((r as any).message, /not a valid key/, key);
	}
	for (const key of ["alt+r", "alt+/", "ctrl+alt+0", "alt+space", "alt+up", "super+r", "f12", "alt+f5", "alt+pageup"]) {
		assert.ok(applyEdit(undefined, { type: "bind", key }).ok, key);
	}
});

test("S17 keymap: saveEdit throws KeymapRefusal for refusals (user input) and a plain error for I/O failures", () => {
	const io = { read: () => undefined, write: () => { throw new Error("EACCES"); } };
	assert.throws(() => saveEdit("/h", { type: "bind", key: "ctrl+c" }, io), (e: unknown) => e instanceof KeymapRefusal);
	assert.throws(() => saveEdit("/h", { type: "bind", key: "alt+r" }, io), (e: unknown) => !(e instanceof KeymapRefusal) && /EACCES/.test(String(e)));
});
