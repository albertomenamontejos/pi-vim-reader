import { test } from "node:test";
import assert from "node:assert/strict";
import { copyMessage, openCommand, openEffect, osc52 } from "../../src/ui/actions.ts";

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
