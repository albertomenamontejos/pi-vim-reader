import { test } from "node:test";
import assert from "node:assert/strict";
import { copyMessage, editorCommand, openCommand, openEffect, osc52 } from "../../src/ui/actions.ts";

test("S7 actions: copy message counts lines", () => {
	assert.equal(copyMessage("one"), "Copied 1 line");
	assert.equal(copyMessage("a\nb\nc"), "Copied 3 lines");
});

test("S7 actions: OSC 52 fallback encodes text as base64", () => {
	assert.equal(osc52("hi"), `\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07`);
});

test("S8 actions: open command per platform", () => {
	assert.deepEqual(openCommand("linux", "x"), { command: "xdg-open", args: ["x"] });
	assert.deepEqual(openCommand("darwin", "x"), { command: "open", args: ["x"] });
	assert.deepEqual(openCommand("win32", "x"), { command: "cmd", args: ["/c", "start", "", "x"] });
});

function fakes(existing: string[] = []) {
	const spawned: Array<{ command: string; args: string[] }> = [];
	return {
		spawned,
		deps: {
			cwd: "/work",
			platform: "linux",
			exists: (p: string) => existing.includes(p),
			spawn: async (command: string, args: string[]) => {
				spawned.push({ command, args });
			},
		},
	};
}

test("S8 actions: gx opens the URL and reports it", async () => {
	const { spawned, deps } = fakes();
	const msg = await openEffect({ type: "open-url", url: "https://example.com/a" }, deps);
	assert.equal(msg, "Opened https://example.com/a");
	assert.deepEqual(spawned, [{ command: "xdg-open", args: ["https://example.com/a"] }]);
});

test("S8 actions: gf resolves relative paths against cwd and reports path:line", async () => {
	const { spawned, deps } = fakes(["/work/src/a.ts"]);
	const msg = await openEffect({ type: "open-file", path: "src/a.ts", line: 12 }, deps);
	assert.equal(msg, "Opened /work/src/a.ts:12");
	assert.deepEqual(spawned, [{ command: "xdg-open", args: ["/work/src/a.ts"] }]);
});

test("S8 actions: gf on a missing file does not spawn and reports it", async () => {
	const { spawned, deps } = fakes();
	assert.equal(await openEffect({ type: "open-file", path: "/nope.txt" }, deps), "File not found: /nope.txt");
	assert.deepEqual(spawned, []);
});

test("S8 actions: spawn failure is reported, not thrown", async () => {
	const deps = { ...fakes().deps, spawn: async () => { throw new Error("spawn xdg-open ENOENT"); } };
	assert.equal(await openEffect({ type: "open-url", url: "https://x.y" }, deps), "Open failed: spawn xdg-open ENOENT");
});

test("S11 actions: editorCommand splits $EDITOR, adds +line before the path", () => {
	assert.deepEqual(editorCommand("nvim", "/w/a.ts", 12), { command: "nvim", args: ["+12", "/w/a.ts"] });
	assert.deepEqual(editorCommand("nvim", "/w/a.ts"), { command: "nvim", args: ["/w/a.ts"] });
	assert.deepEqual(editorCommand("code --wait", "/w/a.ts", 3), { command: "code", args: ["--wait", "+3", "/w/a.ts"] });
	assert.equal(editorCommand("  ", "/w/a.ts"), null);
	assert.equal(editorCommand(undefined, "/w/a.ts"), null);
});

function editorFakes(editor: string | undefined, existing: string[] = []) {
	const f = fakes(existing);
	const edited: Array<{ command: string; args: string[] }> = [];
	return {
		...f,
		edited,
		deps: { ...f.deps, editor, edit: (command: string, args: string[]) => { edited.push({ command, args }); } },
	};
}

test("S11 actions: gf opens the file in $EDITOR at the line instead of xdg-open", async () => {
	const { spawned, edited, deps } = editorFakes("nvim", ["/work/src/a.ts"]);
	const msg = await openEffect({ type: "open-file", path: "src/a.ts", line: 12 }, deps);
	assert.equal(msg, "Edited /work/src/a.ts:12 in nvim");
	assert.deepEqual(edited, [{ command: "nvim", args: ["+12", "/work/src/a.ts"] }]);
	assert.deepEqual(spawned, []);
});

test("S11 actions: gf without $EDITOR keeps the xdg-open behaviour; gx never uses the editor", async () => {
	const none = editorFakes(undefined, ["/work/a.ts"]);
	assert.equal(await openEffect({ type: "open-file", path: "a.ts" }, none.deps), "Opened /work/a.ts");
	assert.deepEqual(none.spawned, [{ command: "xdg-open", args: ["/work/a.ts"] }]);
	const url = editorFakes("nvim");
	await openEffect({ type: "open-url", url: "https://x.y" }, url.deps);
	assert.deepEqual(url.edited, []);
	assert.equal(url.spawned.length, 1);
});

test("S11 actions: a missing file never starts the editor; an editor failure is reported", async () => {
	const missing = editorFakes("nvim");
	assert.equal(await openEffect({ type: "open-file", path: "/nope.txt" }, missing.deps), "File not found: /nope.txt");
	assert.deepEqual(missing.edited, []);
	const f = editorFakes("nvim", ["/work/a.ts"]);
	const deps = { ...f.deps, edit: () => { throw new Error("exit status 1"); } };
	assert.equal(await openEffect({ type: "open-file", path: "a.ts" }, deps), "Open failed: exit status 1");
});

test("S12 actions: gf expands ~ and ~/ against the home directory", async () => {
	const f = editorFakes("nvim", ["/home/user/Work/a.ts", "/home/user"]);
	const deps = { ...f.deps, home: "/home/user" };
	assert.equal(await openEffect({ type: "open-file", path: "~/Work/a.ts", line: 4 }, deps), "Edited /home/user/Work/a.ts:4 in nvim");
	assert.deepEqual(f.edited, [{ command: "nvim", args: ["+4", "/home/user/Work/a.ts"] }]);
	assert.equal(await openEffect({ type: "open-file", path: "~" }, deps), "Edited /home/user in nvim");
});

test("S12 actions: ~ without a known home, and ~user, are not expanded (reported as not found)", async () => {
	const f = editorFakes("nvim", ["/work/~/a.ts"]);
	assert.equal(await openEffect({ type: "open-file", path: "~/a.ts" }, f.deps), "File not found: ~/a.ts");
	const withHome = { ...f.deps, home: "/home/user" };
	assert.equal(await openEffect({ type: "open-file", path: "~bob/a.ts" }, withHome), "File not found: ~bob/a.ts");
});
