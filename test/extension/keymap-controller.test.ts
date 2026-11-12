import { test } from "node:test";
import assert from "node:assert/strict";
import { registerVimReader } from "../../src/ui/controller.ts";
import { KeymapRefusal } from "../../src/ui/keymap.ts";

function harness(binding?: () => { state: "default" | "assigned" | "disabled"; key?: string }, withCommands = true, editKeymap?: (edit: any) => string) {
	const shortcuts = new Map<string, { description?: string; handler: (ctx: any) => unknown }>();
	const commands = new Map<string, { description?: string; handler: (args: string, ctx: any) => Promise<void> }>();
	const pi: any = {
		registerShortcut: (key: string, o: any) => void shortcuts.set(key, o),
		on: () => () => {},
	};
	if (withCommands) pi.registerCommand = (name: string, o: any) => void commands.set(name, o);
	let opened = 0;
	const notices: Array<{ text: string; level: string }> = [];
	const ctx = {
		mode: "tui",
		cwd: "/w",
		sessionManager: { getBranch: () => [] },
		ui: { custom: () => { opened++; return new Promise(() => {}); }, notify: (text: string, level: string) => notices.push({ text, level }) },
	};
	registerVimReader(pi, { copy: async () => {}, open: async () => "ok", now: () => 0, setTimer: () => () => {}, throttleMs: 50, ...(binding ? { keymapBinding: binding } : {}), ...(editKeymap ? { editKeymap } : {}) });
	return { shortcuts, commands, ctx, notices, opened: () => opened };
}

test("S15 controller: registers /vim-reader, which opens the reader like the shortcut", async () => {
	const h = harness();
	const command = h.commands.get("vim-reader");
	assert.ok(command, "command registered");
	assert.ok(command.description);
	void command.handler("", h.ctx);
	assert.equal(h.opened(), 1);
});

test("S15 controller: alt+v stays the default key when no key was assigned (or the lookup is unavailable)", () => {
	assert.ok(harness().shortcuts.get("alt+v"));
	assert.ok(harness(() => ({ state: "default" })).shortcuts.get("alt+v"));
});

test("S15 controller: an assigned or disabled key in keymaps.json removes the built-in alt+v but keeps the command", () => {
	for (const binding of [{ state: "assigned" as const, key: "alt+r" }, { state: "disabled" as const }]) {
		const h = harness(() => binding);
		assert.equal(h.shortcuts.size, 0, JSON.stringify(binding));
		assert.ok(h.commands.get("vim-reader"));
	}
});

test("S15 controller: a failing keymap lookup keeps alt+v; hosts without registerCommand still work", () => {
	const h = harness(() => { throw new Error("boom"); });
	assert.ok(h.shortcuts.get("alt+v"));
	const old = harness(undefined, false);
	assert.ok(old.shortcuts.get("alt+v"));
	assert.equal(old.commands.size, 0);
});

test("S16 controller: /vim-reader bind, unbind and reset call the keymap editor and notify the result, without opening the reader", async () => {
	const edits: unknown[] = [];
	const h = harness(undefined, true, (edit) => { edits.push(edit); return `done ${edit.type}`; });
	const run = (args: string) => h.commands.get("vim-reader")!.handler(args, h.ctx);
	await run("bind alt+r");
	await run("unbind");
	await run("reset");
	assert.deepEqual(edits, [{ type: "bind", key: "alt+r" }, { type: "unbind" }, { type: "reset" }]);
	assert.deepEqual(h.notices.map((n) => [n.text, n.level]), [["done bind", "info"], ["done unbind", "info"], ["done reset", "info"]]);
	assert.equal(h.opened(), 0);
});

test("S16 controller: invalid arguments show usage as a warning; a failing editor is reported; no editor says so", async () => {
	const h = harness(undefined, true, () => { throw new Error("keymaps.json is malformed"); });
	const run = (args: string) => h.commands.get("vim-reader")!.handler(args, h.ctx);
	await run("frobnicate");
	await run("bind alt+r");
	assert.equal(h.notices[0]!.level, "warning");
	assert.match(h.notices[0]!.text, /Usage: \/vim-reader/);
	assert.equal(h.notices[1]!.level, "error");
	assert.match(h.notices[1]!.text, /malformed/);
	const none = harness();
	await none.commands.get("vim-reader")!.handler("bind alt+r", none.ctx);
	assert.match(none.notices[0]!.text, /not available/i);
	assert.equal(none.opened(), 0);
});

test("S17 controller: a refusal (bad key, clash) is a warning without the failure prefix", async () => {
	const h = harness(undefined, true, () => { throw new KeymapRefusal("ctrl+c is reserved by Pi."); });
	await h.commands.get("vim-reader")!.handler("bind ctrl+c", h.ctx);
	assert.deepEqual(h.notices, [{ text: "ctrl+c is reserved by Pi.", level: "warning" }]);
});
