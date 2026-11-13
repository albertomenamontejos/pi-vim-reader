import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStyledTranscript, createStyledSource, findChatContainer, plainText, toggleBlock } from "../../src/ui/styled.ts";

const comp = (lines: string[] | ((w: number) => string[])) => ({
	render: (w: number) => (typeof lines === "function" ? lines(w) : lines),
});
const container = (children: unknown[]) => ({
	children,
	render(w: number) {
		return (this.children as Array<{ render(w: number): string[] }>).flatMap((c) => c.render(w));
	},
});

/** Mirrors Pi 1.5.2: tui.children[0] is documentContainer = [header, loadedResources, chat]. */
function fakeTui(chatChildren: unknown[]) {
	const chat = container(chatChildren);
	const doc = container([container([comp(["logo"])]), container([]), chat]);
	const editor = container([comp(["> "])]);
	const footer = container([comp(["footer"])]);
	return { tui: { terminal: { rows: 10, columns: 40 }, children: [doc, container([]), container([]), editor, footer] }, chat };
}

test("styled: plainText strips SGR, OSC 8 and APC sequences keeping visible text", () => {
	assert.equal(plainText("\x1b[1mbold\x1b[22m \x1b]8;;https://x.io\x07link\x1b]8;;\x07\x1b_pi:c\x07!"), "bold link!");
	assert.equal(plainText("no escapes"), "no escapes");
});

test("S2 styled: findChatContainer returns the third child of the document container", () => {
	const { tui, chat } = fakeTui([comp(["a"])]);
	assert.equal(findChatContainer(tui), chat);
	// Works through a Proxy like Pi's createInteractiveTuiReference.
	const proxy = new Proxy({}, { get: (_t, p) => Reflect.get(tui, p, tui) });
	assert.equal(findChatContainer(proxy), chat);
});

test("styled: findChatContainer returns undefined for unknown shapes", () => {
	assert.equal(findChatContainer(undefined), undefined);
	assert.equal(findChatContainer({}), undefined);
	assert.equal(findChatContainer({ children: [comp(["x"])] }), undefined);
	assert.equal(findChatContainer({ children: [container([comp(["a"]), comp(["b"])])] }), undefined);
	const throwing = { get children(): unknown[] { throw new Error("boom"); } };
	assert.equal(findChatContainer(throwing), undefined);
});

test("S2 styled: meta follows chat children; blank-only children (spacers) join the previous message", () => {
	const chat = container([
		comp(["\x1b[1m You \x1b[22m", " hello"]),
		comp([""]),
		comp(["\x1b[36m answer\x1b[39m", " more"]),
		comp(["", "   "]),
		comp([" tool"]),
	]);
	const t = buildStyledTranscript(chat, 40);
	// Trailing padding is dropped from the plain text, kept in the styled line.
	assert.deepEqual(t.lines, [" You", " hello", "", " answer", " more", "", "", " tool"]);
	assert.deepEqual(t.styled, ["\x1b[1m You \x1b[22m", " hello", "", "\x1b[36m answer\x1b[39m", " more", "", "   ", " tool"]);
	assert.deepEqual(t.meta, [0, 0, 0, 1, 1, 1, 1, 2]);
});

test("styled: children render at the requested width", () => {
	const widths: number[] = [];
	const chat = container([comp((w) => (widths.push(w), ["x"]))]);
	buildStyledTranscript(chat, 37);
	assert.deepEqual(widths, [37]);
});

test("styled: Kitty/iTerm2 image lines become an [image] placeholder in plain and styled output", () => {
	const chat = container([comp(["", "\x1b[1A\x1b_Ga=T,f=100;AAAA\x1b\\", "\x1b]1337;File=inline=1:AAAA\x07"])]);
	const t = buildStyledTranscript(chat, 40);
	assert.deepEqual(t.lines, ["", "[image]", "[image]"]);
	assert.deepEqual(t.styled, ["", "[image]", "[image]"]);
});

test("styled: createStyledSource falls back (null) when no container, when empty, or when render throws", () => {
	assert.equal(createStyledSource({ children: [] })(40), null);
	assert.equal(createStyledSource(fakeTui([]).tui)(40), null);
	const broken = fakeTui([{ render: () => { throw new Error("render failed"); } }]).tui;
	assert.equal(createStyledSource(broken)(40), null);
	const ok = createStyledSource(fakeTui([comp(["\x1b[2mhi\x1b[22m"])]).tui)(40);
	assert.deepEqual(ok, { lines: ["hi"], styled: ["\x1b[2mhi\x1b[22m"], meta: [0], user: [false], child: [0] });
});

test("S4 styled: createStyledSource re-reads chat children on every call (live output)", () => {
	const { tui, chat } = fakeTui([comp(["one"])]);
	const source = createStyledSource(tui);
	assert.deepEqual(source(40)?.lines, ["one"]);
	chat.children.push(comp(["two"]));
	assert.deepEqual(source(40)?.lines, ["one", "two"]);
	// Pi's Container.clear() replaces the children array.
	chat.children = [comp(["fresh"])];
	assert.deepEqual(source(40)?.lines, ["fresh"]);
});

test("S13 styled: every line reports the chat child it came from", () => {
	const comp = (lines: string[]) => ({ render: (_w: number) => lines });
	const t = buildStyledTranscript({ children: [comp(["a1", "a2"]), comp([""]), comp(["b1"])], render: () => [] } as any, 20);
	assert.deepEqual(t.child, [0, 0, 1, 2]);
});

test("S13 styled: toggleBlock flips one block's own expanded state, or reports why not", () => {
	const block = (expanded: boolean) => {
		const b: any = { expanded, calls: 0, render: () => [""], setExpanded(v: boolean) { b.expanded = v; b.calls++; } };
		return b;
	};
	const a = block(false);
	const b = block(true);
	const chat: any = { children: [a, { render: () => [""] }, b], render: () => [] };
	assert.equal(toggleBlock(chat, 0), "expanded");
	assert.equal(a.expanded, true);
	assert.equal(toggleBlock(chat, 0), "collapsed");
	assert.equal(toggleBlock(chat, 2), "collapsed");
	assert.equal(b.expanded, false);
	assert.equal(toggleBlock(chat, 1), null, "no setExpanded");
	assert.equal(toggleBlock(chat, 9), null, "out of range");
	assert.equal(toggleBlock(undefined, 0), null);
	const noState: any = { children: [{ render: () => [""], setExpanded() {} }], render: () => [] };
	assert.equal(toggleBlock(noState, 0), null, "unknown current state is not guessed");
});

test("S13 styled: child index counts skipped children (non-component, empty render)", () => {
	const chat: any = { children: [null, { render: () => [] }, { render: () => ["x"] }, "str", { render: () => ["y"] }], render: () => [] };
	assert.deepEqual(buildStyledTranscript(chat, 10).child, [2, 4]);
});

test("S13 styled: toggleBlock rejects a block whose expanded is not a boolean", () => {
	const chat: any = { children: [{ render: () => [""], expanded: undefined, setExpanded() { throw new Error("must not run"); } }], render: () => [] };
	assert.equal(toggleBlock(chat, 0), null);
});

test("S17 styled: user flag per message marks only user-message components", () => {
	const userChild = { ...comp(["you said", "more"]), text: "you said", markdownTheme: {} };
	const assistantChild = { ...comp(["answer"]), contentContainer: {}, text: "answer", markdownTheme: {} };
	const spacer = comp([""]);
	const t = buildStyledTranscript(container([userChild, spacer, assistantChild, { ...userChild }]), 40);
	assert.deepEqual(t.meta, [0, 0, 0, 1, 2, 2]);
	assert.deepEqual(t.user, [true, false, true]);
});
