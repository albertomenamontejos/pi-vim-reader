import { test } from "node:test";
import assert from "node:assert/strict";
import { registerVimReader } from "../../src/ui/controller.ts";

type Handler = (event: any, ctx?: any) => unknown;

const msg = (message: unknown) => ({ type: "message", id: "e", parentId: null, timestamp: "t", message });
const user = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });
const assistant = (text: string, timestamp: number) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp });

function harness(opts: { rows?: number } = {}) {
	const shortcuts = new Map<string, { description?: string; handler: (ctx: any) => unknown }>();
	const handlers = new Map<string, Handler[]>();
	const pi = {
		registerShortcut(key: string, options: { description?: string; handler: (ctx: any) => unknown }) {
			shortcuts.set(key, options);
		},
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {
				const l = handlers.get(event) ?? [];
				const i = l.indexOf(handler);
				if (i >= 0) l.splice(i, 1);
			};
		},
	};
	const emit = (event: string, payload: unknown) => {
		for (const h of [...(handlers.get(event) ?? [])]) h(payload);
	};
	const handlerCount = () => [...handlers.values()].reduce((n, l) => n + l.length, 0);

	const entries: unknown[] = [msg(user("hello", 1)), msg(assistant("line one\nline two", 2))];
	const renders: Array<boolean | undefined> = [];
	const writes: string[] = [];
	const scrolled: string[] = [];
	const tui: any = {
		terminal: { rows: opts.rows ?? 6, columns: 40, write: (s: string) => writes.push(s) },
		requestRender: (force?: boolean) => renders.push(force),
		scrollToBottom: () => scrolled.push("bottom"),
	};
	let component: any;
	let customOptions: any;
	let resolved: unknown = "pending";
	const ctx = {
		mode: "tui",
		cwd: "/work",
		sessionManager: { getBranch: () => entries },
		ui: {
			custom(factory: any, options: any) {
				customOptions = options;
				return new Promise((resolve) => {
					component = factory(tui, {}, {}, (value: unknown) => {
						resolved = value;
						resolve(value);
					});
				});
			},
		},
	};

	const copied: string[] = [];
	const opened: unknown[] = [];
	let clock = 0;
	const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
	const services = {
		copy: async (text: string) => {
			copied.push(text);
		},
		open: async (effect: unknown) => {
			opened.push(effect);
			return "Opened it";
		},
		now: () => clock,
		setTimer: (fn: () => void, ms: number) => {
			const t = { at: clock + ms, fn, cancelled: false };
			timers.push(t);
			return () => {
				t.cancelled = true;
			};
		},
		throttleMs: 50,
	};
	const advance = (ms: number) => {
		clock += ms;
		for (const t of timers.splice(0)) {
			if (t.cancelled) continue;
			if (t.at <= clock) t.fn();
			else timers.push(t);
		}
	};
	registerVimReader(pi as any, services);
	return {
		shortcuts, emit, handlerCount, entries, renders, writes, scrolled, tui, ctx, copied, opened, advance,
		get component() { return component; },
		get customOptions() { return customOptions; },
		get resolved() { return resolved; },
		press(...keys: string[]) { for (const k of keys) component.handleInput(k); },
		status(width = 40): string { const out: string[] = component.render(width); return out[out.length - 1]; },
		pos(width = 40): { row: number; total: number } {
			const m = /(\d+)\/(\d+)/.exec(this.status(width).replace(/\x1b\[[0-9;]*m/g, ""));
			assert.ok(m, "status shows row/total");
			return { row: Number(m[1]), total: Number(m[2]) };
		},
	};
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("S3: registers alt+v and opens a full-screen focused component over the conversation", async () => {
	const h = harness();
	const shortcut = h.shortcuts.get("alt+v");
	assert.ok(shortcut, "alt+v registered");
	assert.ok(shortcut.description);
	void shortcut.handler(h.ctx);
	assert.ok(h.component, "custom() factory ran");
	assert.equal(h.customOptions.overlay, true);
	// No chat layout in this harness: the overlay falls back to the whole terminal (S10 covers the chat region).
	assert.equal(h.customOptions.overlayOptions.anchor, "top-left");
	assert.deepEqual(h.customOptions.overlayOptions.margin, { top: 0, right: 0, bottom: 0, left: 0 });
	assert.equal(h.customOptions.overlayOptions.width, 40);
	assert.equal(h.customOptions.overlayOptions.maxHeight, 6);
	assert.equal(h.component.capturesViewportInput, true);
	const out: string[] = h.component.render(40);
	assert.equal(out.length, 6, "exactly terminal rows");
	assert.match(plain(out[5]), /^NORMAL  FOLLOW/);
	// S2: whole conversation; last line of the buffer (blank separator) is the cursor line
	const text = out.map(plain).join("\n");
	assert.match(text, /line two/);
	assert.deepEqual(h.pos(), { row: 7, total: 7 });
});

test("S4: k detaches; streamed updates keep the cursor; G re-attaches and follows", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("k");
	assert.doesNotMatch(plain(h.status()), /FOLLOW/);
	assert.deepEqual(h.pos(), { row: 6, total: 7 });

	h.emit("message_update", { type: "message_update", message: assistant("streamed a\nstreamed b", 3) });
	assert.deepEqual(h.pos(), { row: 6, total: 11 }, "detached cursor stays put while lines grow");

	h.press("G");
	assert.match(plain(h.status()), /FOLLOW/);
	h.advance(100);
	h.emit("message_update", { type: "message_update", message: assistant("streamed a\nstreamed b\nstreamed c", 3) });
	assert.deepEqual(h.pos(), { row: 12, total: 12 }, "following cursor tracks the new last line");
	assert.ok(h.renders.length > 0, "requestRender called on updates");
});

test("S4: message_update rebuilds are throttled; message_end flushes immediately", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.emit("message_update", { message: assistant("a", 3) });
	assert.equal(h.pos().total, 10);
	h.advance(10);
	h.emit("message_update", { message: assistant("a\nb", 3) });
	assert.equal(h.pos().total, 10, "second update within 50ms is deferred");
	h.advance(40);
	assert.equal(h.pos().total, 11, "deferred rebuild fires after the throttle window");
	h.advance(1);
	h.emit("message_update", { message: assistant("a\nb\nc", 3) });
	h.emit("message_end", { message: assistant("a\nb\nc\nd", 3) });
	assert.equal(h.pos().total, 13, "message_end rebuilds immediately with the final message");
	// persisted entry + turn_end: no duplicate
	h.entries.push(msg(assistant("a\nb\nc\nd", 3)));
	h.emit("turn_end", { message: assistant("a\nb\nc\nd", 3) });
	assert.equal(h.pos().total, 13);
	h.advance(1000);
	assert.equal(h.pos().total, 13, "no stale deferred rebuild re-adds streaming");
});

test("S4: width change re-wraps on render", () => {
	const h = harness();
	h.entries.push(msg(assistant("x".repeat(30), 3)));
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	const wide = h.pos(40).total;
	const narrow = h.pos(10).total;
	assert.ok(narrow > wide, `narrow ${narrow} > wide ${wide}`);
});

test("S7: yy copies the cursor line through the injected clipboard and reports it", async () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("k", "y", "y");
	assert.deepEqual(h.copied, ["line two"]);
	await new Promise((r) => setImmediate(r));
	assert.match(plain(h.status()), /Copied 1 line/);
});

test("S7: V + y copies multiple lines", async () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("k", "V", "k");
	assert.match(plain(h.status()), /^V-LINE/);
	h.press("y");
	assert.deepEqual(h.copied, ["line one\nline two"]);
	await new Promise((r) => setImmediate(r));
	assert.match(plain(h.status()), /Copied 2 lines/);
});

test("S8: open effects go to the injected opener and its message shows", async () => {
	const h = harness();
	h.entries.push(msg(assistant("see https://example.com now", 3)));
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(80);
	h.press("k", "w", "g", "x");
	assert.deepEqual(h.opened, [{ type: "open-url", url: "https://example.com" }]);
	await new Promise((r) => setImmediate(r));
	assert.match(plain(h.status(80)), /Opened it/);
});

test("S6: search shows the query and a not-found message", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("/", "z", "z");
	assert.match(plain(h.status()), /^\/zz/);
	h.press("\r");
	assert.match(plain(h.status(80)), /Pattern not found: zz/);
	h.press("j");
	assert.doesNotMatch(plain(h.status(80)), /Pattern not found/, "message clears on the next key");
});

for (const key of ["q"]) {
	test(`S3: ${JSON.stringify(key)} closes, resolves custom(), unsubscribes listeners and forces a repaint`, async () => {
		const h = harness();
		assert.equal(h.handlerCount(), 0, "no listeners before opening");
		const pending = h.shortcuts.get("alt+v")!.handler(h.ctx);
		h.component.render(40);
		assert.equal(h.handlerCount(), 4, "message_update, message_end, turn_end, agent_end");
		h.press(key);
		await pending;
		assert.equal(h.resolved, undefined);
		assert.equal(h.handlerCount(), 0);
		assert.ok(h.renders.includes(true), "requestRender(true) after close");
		// events after close are ignored
		h.emit("message_update", { message: assistant("late", 9) });
	});
}

test("S3: Esc never closes the reader (a double Esc must not reach Pi and abort the agent)", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("\x1b", "\x1b");
	assert.equal(h.resolved, "pending");
	assert.equal(h.handlerCount(), 4, "still open and subscribed");
});

test("S3: a second alt+v while open does not open another reader", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	const first = h.component;
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	assert.equal(h.component, first);
	assert.equal(h.handlerCount(), 4);
});

test("S3: does nothing outside the TUI", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler({ ...h.ctx, mode: "rpc" });
	assert.equal(h.component, undefined);
});

test("S19: q while following the end scrolls the chat to the bottom before the repaint", async () => {
	const h = harness();
	const pending = h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("q");
	await pending;
	assert.deepEqual(h.scrolled, ["bottom"]);
	assert.ok(h.renders.includes(true), "still repaints");
});

test("S19: q with the cursor moved away from the end leaves the chat where it is", async () => {
	const h = harness();
	const pending = h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("k", "k", "q");
	await pending;
	assert.deepEqual(h.scrolled, []);
});

test("S19: q never fails when the chat has no scrollToBottom", async () => {
	const h = harness();
	delete h.tui.scrollToBottom;
	const pending = h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	h.press("q");
	await pending;
	assert.ok(h.renders.includes(true));
});

const wheel = (wheelDelta: number) => ({ type: "wheel", button: "none", x: 1, y: 1, screenX: 1, screenY: 1, width: 40, height: 5, shift: false, alt: false, ctrl: false, wheelDelta });

test("S20: the mouse wheel scrolls the reader, handled so the chat underneath does not move", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	assert.deepEqual(h.pos(), { row: 7, total: 7 });
	const up = h.component.handleMouse(wheel(-3));
	assert.equal(up?.handled, true);
	assert.ok(h.pos().row < 7, "moved off the last line");
	assert.doesNotMatch(plain(h.status()), /FOLLOW/);
	h.component.handleMouse(wheel(10));
	assert.deepEqual(h.pos(), { row: 7, total: 7 });
	assert.match(plain(h.status()), /FOLLOW/);
});

test("S20: non-wheel mouse events are ignored", () => {
	const h = harness();
	void h.shortcuts.get("alt+v")!.handler(h.ctx);
	h.component.render(40);
	const before = h.pos();
	h.component.handleMouse({ ...wheel(0), type: "click", button: "left", wheelDelta: undefined });
	assert.deepEqual(h.pos(), before);
});
