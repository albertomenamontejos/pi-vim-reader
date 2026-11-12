import { test } from "node:test";
import assert from "node:assert/strict";
import { registerVimReader } from "../../src/ui/controller.ts";

const comp = (lines: string[]) => ({ render: (_w: number) => lines });
const container = (children: unknown[]) => ({ children, render: (w: number) => children.flatMap((c: any) => c.render(w)) });

interface Opts {
	rect?: { x: number; y: number; width: number; height: number } | null;
	scroll?: { scrollTop: number; contentHeight: number; viewportHeight: number; isFollowingEnd: boolean };
	chatLines?: number;
}

function harness(opts: Opts = {}) {
	let shortcut: (ctx: any) => unknown = () => {};
	const pi = {
		registerShortcut: (_k: string, o: { handler: (ctx: any) => unknown }) => {
			shortcut = o.handler;
		},
		on: () => () => {},
	};
	const n = opts.chatLines ?? 4;
	const chat = container([comp(Array.from({ length: n }, (_, i) => ` line ${i + 1}`))]);
	const sv = { ...(opts.scroll ?? { scrollTop: 0, contentHeight: n, viewportHeight: n, isFollowingEnd: true }) };
	const rect = opts.rect === undefined ? { x: 0, y: 1, width: 60, height: 10 } : opts.rect;
	const layout = rect === null ? undefined : { root: { rect: { x: 0, y: 0, width: 80, height: 14 }, children: [{ rect, scrollView: sv, children: [] }] } };
	const renders: Array<boolean | undefined> = [];
	const tui: any = {
		terminal: { rows: 14, columns: 80 },
		requestRender: (force?: boolean) => renders.push(force),
		children: [container([container([]), container([]), chat])],
		currentLayout: layout,
		getPrimaryScrollView: () => sv,
	};
	let component: any;
	let customOptions: any;
	const ctx = {
		mode: "tui",
		cwd: "/w",
		sessionManager: { getBranch: () => [] },
		ui: {
			custom: (factory: any, options: any) =>
				new Promise(() => {
					customOptions = options;
					component = factory(tui, {}, {}, () => {});
				}),
		},
	};
	registerVimReader(pi as any, { copy: async () => {}, open: async () => "ok", now: () => 0, setTimer: () => () => {}, throttleMs: 50 });
	void shortcut(ctx);
	return { tui, renders, get component() { return component; }, get options() { return customOptions.overlayOptions; } };
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("S10 the overlay covers only the chat rect: top-left anchor with margins from the layout", () => {
	const h = harness({ rect: { x: 0, y: 1, width: 60, height: 10 } });
	assert.equal(h.options.anchor, "top-left");
	assert.deepEqual(h.options.margin, { top: 1, right: 20, bottom: 3, left: 0 });
	assert.equal(h.options.width, 60);
	assert.equal(h.options.maxHeight, 10);
});

test("S10 the component renders exactly the region rows at the region width, status line last", () => {
	const h = harness({ rect: { x: 0, y: 1, width: 60, height: 10 } });
	const out: string[] = h.component.render(60);
	assert.equal(out.length, 10);
	assert.match(plain(out[9]!), /^NORMAL  FOLLOW/);
});

test("S10 margins follow layout changes (a taller prompt) in place and request a repaint", () => {
	const h = harness({ rect: { x: 0, y: 1, width: 60, height: 10 } });
	const before = h.options;
	h.component.render(60);
	const n = h.renders.length;
	h.tui.currentLayout.root.children[0].rect = { x: 0, y: 1, width: 60, height: 8 };
	const out: string[] = h.component.render(60);
	assert.equal(h.options, before, "same options object");
	assert.equal(h.options.margin.bottom, 5);
	assert.equal(h.options.maxHeight, 8);
	assert.ok(h.renders.length > n, "repaint requested");
	assert.equal(out.length, 8);
});

test("S10 unknown layout falls back to the full-screen geometry", () => {
	const h = harness({ rect: null });
	assert.deepEqual(h.options.margin, { top: 0, right: 0, bottom: 0, left: 0 });
	assert.equal(h.component.render(80).length, 14);
});

test("S10 opens where the chat is scrolled: cursor on the first visible line, follow off", () => {
	const h = harness({
		chatLines: 40,
		rect: { x: 0, y: 1, width: 60, height: 10 },
		scroll: { scrollTop: 12, contentHeight: 50, viewportHeight: 10, isFollowingEnd: false },
	});
	const out: string[] = h.component.render(60);
	const status = plain(out[out.length - 1]!);
	assert.doesNotMatch(status, /FOLLOW/);
	// 10 header lines above the chat: scrollTop 12 is chat line 3 (1-based row 3)
	assert.match(status, /\b3\/40\b/);
});

test("S10 opens following when the chat is at the bottom", () => {
	const h = harness({ chatLines: 40, rect: { x: 0, y: 1, width: 60, height: 10 }, scroll: { scrollTop: 40, contentHeight: 50, viewportHeight: 10, isFollowingEnd: true } });
	const out: string[] = h.component.render(60);
	assert.match(plain(out[out.length - 1]!), /FOLLOW/);
});
