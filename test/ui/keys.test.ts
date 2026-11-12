import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKey } from "../../src/ui/keys.ts";

test("S3/S5 keys: raw fallback maps control bytes to core tokens", () => {
	assert.deepEqual(normalizeKey("\x1b"), ["escape"]);
	assert.deepEqual(normalizeKey("\r"), ["enter"]);
	assert.deepEqual(normalizeKey("\n"), ["enter"]);
	assert.deepEqual(normalizeKey("\x7f"), ["backspace"]);
	assert.deepEqual(normalizeKey("\x08"), ["backspace"]);
	assert.deepEqual(normalizeKey("\x04"), ["ctrl+d"]);
	assert.deepEqual(normalizeKey("\x15"), ["ctrl+u"]);
	assert.deepEqual(normalizeKey(" "), ["space"]);
	assert.deepEqual(normalizeKey("\x1b[A"), ["up"]);
	assert.deepEqual(normalizeKey("\x1b[B"), ["down"]);
	assert.deepEqual(normalizeKey("\x1b[C"), ["right"]);
	assert.deepEqual(normalizeKey("\x1b[D"), ["left"]);
});

test("S5 keys: printable characters pass through, including shifted and symbols", () => {
	for (const ch of ["j", "k", "G", "$", "0", "]", "[", "/", "?", "n", "N", "v", "V", "y", "q", "é"]) {
		assert.deepEqual(normalizeKey(ch), [ch]);
	}
});

test("S6 keys: pasted printable text splits into one token per character", () => {
	assert.deepEqual(normalizeKey("foo bar"), ["f", "o", "o", "space", "b", "a", "r"]);
});

test("keys: unknown escape sequences and other control bytes yield no tokens", () => {
	assert.deepEqual(normalizeKey("\x1b[999~"), []);
	assert.deepEqual(normalizeKey("\x01"), []);
	assert.deepEqual(normalizeKey(""), []);
});

test("keys: injected pi-tui helpers win (kitty CSI-u printable and ctrl keys)", () => {
	const helpers = {
		decodePrintable: (d: string) => (d === "\x1b[71;2u" ? "G" : d === "\x1b[32u" ? " " : undefined),
		parseKey: (d: string) => (d === "\x1b[100;5u" ? "ctrl+d" : d === "\x1b[1;5A" ? "ctrl+up" : undefined),
	};
	assert.deepEqual(normalizeKey("\x1b[71;2u", helpers), ["G"]);
	assert.deepEqual(normalizeKey("\x1b[32u", helpers), ["space"]);
	assert.deepEqual(normalizeKey("\x1b[100;5u", helpers), ["ctrl+d"]);
	assert.deepEqual(normalizeKey("\x1b[1;5A", helpers), ["ctrl+up"]);
	// helpers that know nothing fall back to raw decoding
	assert.deepEqual(normalizeKey("\x04", helpers), ["ctrl+d"]);
});

test("keys: parseKey 'shift+<letter>' becomes the uppercase character", () => {
	const helpers = { parseKey: (d: string) => (d === "\x1b[103;2u" ? "shift+g" : undefined) };
	assert.deepEqual(normalizeKey("\x1b[103;2u", helpers), ["G"]);
});
