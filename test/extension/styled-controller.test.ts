import { test } from "node:test";
import assert from "node:assert/strict";
import { registerVimReader } from "../../src/ui/controller.ts";

const comp = (lines: string[]) => ({ render: (_w: number) => lines });
const container = (children: unknown[]) => ({ children, render: (w: number) => children.flatMap((c: any) => c.render(w)) });

function harness(chatChildren: unknown[] | null) {
	let shortcut: (ctx: any) => unknown = () => {};
	const handlers = new Map<string, Array<(e: any) => unknown>>();
	const pi = {
		registerShortcut: (_k: string, o: { handler: (ctx: any) => unknown }) => {
			shortcut = o.handler;
		},
		on: (event: string, h: (e: any) => unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), h]);
			return () => {};
		},
	};
	const chat = container(chatChildren ?? []);
	const children = chatChildren === null ? [] : [container([container([]), container([]), chat]), container([])];
	const tui = { terminal: { rows: 6, columns: 30 }, requestRender: () => {}, children };
	const entries = [
		{ type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "plain answer" }], timestamp: 2 } },
	];
	let component: any;
	const copied: string[] = [];
	const ctx = {
		mode: "tui",
		cwd: "/w",
		sessionManager: { getBranch: () => entries },
		ui: { custom: (factory: any) => new Promise(() => { component = factory(tui, {}, {}, () => {}); }) },
	};
	registerVimReader(pi as any, {
		copy: async (t: string) => {
			copied.push(t);
		},
		open: async () => "ok",
		now: () => 0,
		setTimer: () => () => {},
		throttleMs: 50,
	});
	void shortcut(ctx);
	return {
		chat,
		copied,
		emit: (e: string, p: unknown) => (handlers.get(e) ?? []).forEach((h) => h(p)),
		render: (): string[] => component.render(30),
		press: (...keys: string[]) => keys.forEach((k) => component.handleInput(k)),
		pos(): { row: number; total: number } {
			const out = component.render(30) as string[];
			const m = /(\d+)\/(\d+)/.exec(out[out.length - 1]!.replace(/\x1b\[[0-9;]*m/g, ""));
			assert.ok(m);
			return { row: Number(m[1]), total: Number(m[2]) };
		},
	};
}

test("S2 styled reader: shows the chat's own ANSI lines, keeps exact height and the status line", () => {
	const h = harness([comp(["\x1b[1m You\x1b[22m", " hello"]), comp([""]), comp(["\x1b[36m answer\x1b[39m"])]);
	const out = h.render();
	assert.equal(out.length, 6);
	assert.equal(out[0], "\x1b[1m You\x1b[22m");
	assert.equal(out[1], " hello");
	// Following: cursor on the last line, column 0, inverse cell inside the original color.
	assert.ok(out[3]!.startsWith("\x1b[36m\x1b[7m \x1b[27m"), JSON.stringify(out[3]));
	assert.ok(out[3]!.endsWith("answer\x1b[39m"), JSON.stringify(out[3]));
	assert.equal(out[4], "~");
	assert.match(out[5]!, /NORMAL  FOLLOW/);
});

test("S2 styled reader: ]] and [[ jump between chat children (spacers belong to the previous message)", () => {
	const h = harness([comp(["a1", "a2"]), comp([""]), comp(["b1"]), comp([""]), comp(["c1"])]);
	h.press("g", "g");
	assert.deepEqual(h.pos(), { row: 1, total: 6 });
	h.press("]", "]");
	assert.equal(h.pos().row, 4);
	h.press("]", "]");
	assert.equal(h.pos().row, 6);
	h.press("[", "[");
	assert.equal(h.pos().row, 4);
});

test("S4 styled reader: follows live chat output on render, k detaches, G re-attaches", () => {
	const h = harness([comp(["one"])]);
	assert.deepEqual(h.pos(), { row: 1, total: 1 });
	h.chat.children.push(comp(["two", "three"]));
	assert.deepEqual(h.pos(), { row: 3, total: 3 }, "following picks up new chat lines on render");
	h.press("k");
	h.chat.children.push(comp(["four"]));
	assert.deepEqual(h.pos(), { row: 2, total: 4 }, "detached cursor stays");
	h.press("G");
	h.chat.children.push(comp(["five"]));
	h.emit("message_update", { message: { role: "assistant", content: [], timestamp: 9 } });
	assert.deepEqual(h.pos(), { row: 5, total: 5 });
});

test("S4 styled reader: horizontal motion on the followed last line is not reset by unchanged renders", () => {
	const h = harness([comp(["abc"])]);
	h.render();
	h.press("l", "l");
	const out = h.render();
	assert.equal(out[0], "ab\x1b[7mc\x1b[27m\x1b[0m");
});

test("S7/S8 styled reader: yank and gx work on the plain text of styled lines", async () => {
	const h = harness([comp(["\x1b[1mbold\x1b[22m see \x1b]8;;https://x.io\x07https://x.io\x1b]8;;\x07"])]);
	h.press("y", "y");
	assert.deepEqual(h.copied, ["bold see https://x.io"]);
});

test("styled reader: falls back to the plain transcript when the chat container is missing", () => {
	const h = harness(null);
	const text = h.render().join("\n");
	assert.match(text, /── Assistant ──/);
	assert.match(text, /plain answer/);
});

test("styled reader: falls back to the plain transcript when the chat render throws", () => {
	const h = harness([{ render: () => { throw new Error("boom"); } }]);
	assert.match(h.render().join("\n"), /plain answer/);
});

test("S7 styled reader: yy and $ ignore the chat's trailing padding", () => {
	const h = harness([comp([" hello     "])]);
	h.press("$", "y", "y");
	assert.deepEqual(h.copied, [" hello"]);
	assert.equal(h.render()[0], ` hell\x1b[7mo\x1b[27m\x1b[0m     `);
});

function toggleHarness(setTools: boolean, trailing = false) {
	const mk = (expanded: boolean | undefined) => {
		const b: any = { render: () => (b.expanded ? [" $ cmd", " out1", " out2"] : [" $ cmd (ctrl+o to expand)"]), setExpanded(v: boolean) { b.expanded = v; } };
		if (expanded !== undefined) b.expanded = expanded;
		return b;
	};
	const block = mk(false);
	const plainBlock = comp([" answer"]);
	const chat = container([plainBlock, comp([""]), block, ...(trailing ? [comp([" tail1", " tail2"])] : [])]);
	const tools = { expanded: false, calls: 0 };
	let shortcut: (ctx: any) => unknown = () => {};
	let component: any;
	const renders: number[] = [];
	const tui = { terminal: { rows: 8, columns: 60 }, requestRender: () => renders.push(1), children: [container([container([]), container([]), chat])] };
	const ctx: any = {
		mode: "tui",
		cwd: "/w",
		sessionManager: { getBranch: () => [] },
		ui: {
			custom: (factory: any) => new Promise(() => { component = factory(tui, {}, {}, () => {}); }),
			...(setTools ? { getToolsExpanded: () => tools.expanded, setToolsExpanded: (v: boolean) => { tools.expanded = v; tools.calls++; } } : {}),
		},
	};
	registerVimReader({ registerShortcut: (_k: string, o: any) => { shortcut = o.handler; }, on: () => () => {} } as any, { copy: async () => {}, open: async () => "ok", now: () => 0, setTimer: () => () => {}, throttleMs: 50 });
	void shortcut(ctx);
	const status = () => (component.render(60) as string[]).at(-1)!.replace(/\x1b\[[0-9;]*m/g, "");
	return { block, plainBlock, tools, renders, component: () => component, status, rows: () => component.render(60) as string[] };
}

test("S13 controller: ctrl+o on a tool block expands it in place, again collapses it, and repaints", () => {
	const h = toggleHarness(true);
	h.rows();
	assert.equal(h.rows().length, 8);
	h.component().handleInput("\x0f"); // cursor starts on the last line: the tool block
	assert.equal(h.block.expanded, true);
	assert.match(h.status(), /Expanded block/);
	assert.ok(h.rows().some((r) => r.includes("out2")), "reader shows the expanded block");
	assert.ok(h.renders.length > 0);
	h.component().handleInput("\x0f");
	assert.equal(h.block.expanded, false);
	assert.match(h.status(), /Collapsed block/);
	assert.equal(h.tools.calls, 0, "global toggle untouched");
});

test("S13 controller: ctrl+o on a line without an expandable block falls back to the global tool toggle", () => {
	const h = toggleHarness(true);
	h.rows();
	h.component().handleInput("g");
	h.component().handleInput("g"); // first line: plain answer, no setExpanded
	h.component().handleInput("\x0f");
	assert.equal(h.tools.calls, 1);
	assert.equal(h.tools.expanded, true);
	assert.match(h.status(), /All tool output expanded/);
});

test("S13 controller: nothing expandable and no global toggle reports it", () => {
	const h = toggleHarness(false);
	h.rows();
	h.component().handleInput("g");
	h.component().handleInput("g");
	h.component().handleInput("\x0f");
	assert.match(h.status(), /Nothing to expand/);
});

test("S13 controller: collapsing with the cursor inside the block leaves it on the block's first line", () => {
	const h = toggleHarness(true, true);
	h.block.setExpanded(true); // lines: answer, "", $ cmd, out1, out2, tail1, tail2
	h.rows();
	h.component().handleInput("g");
	h.component().handleInput("g");
	for (let i = 0; i < 4; i++) h.component().handleInput("j"); // row 5 (1-based): out2, inside the block
	assert.match(h.status(), /\b5\/7\b/);
	h.component().handleInput("\x0f"); // collapse from inside
	assert.equal(h.block.expanded, false);
	assert.match(h.status(), /\b3\/5\b/, "cursor on the block's header line, not on whatever now holds row 5");
});
