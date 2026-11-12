import { test } from "node:test";
import assert from "node:assert/strict";
import { make, press } from "./helpers.ts";

const lines = ["hello world", "second line", "", "third"];

test("S7: v enters charwise visual, motions extend, y copies and returns to normal at selection start", () => {
	const s = make(lines, { row: 0, col: 6 });
	const v = press(s, "v").state;
	assert.equal(v.mode, "visual");
	const r = press(v, "j", "b", "y");
	// vim charwise visual is inclusive of both anchor and cursor: (0,6)..(1,0)
	assert.deepEqual(r.effects, [{ type: "copy", text: "world\ns" }]);
	assert.equal(r.state.mode, "normal");
	assert.deepEqual(r.state.cursor, { row: 0, col: 6 });
});

test("S7: charwise selection works backwards (cursor before anchor)", () => {
	const s = make(lines, { row: 1, col: 3 });
	const r = press(s, "v", "k", "y");
	assert.deepEqual(r.effects, [{ type: "copy", text: "lo world\nseco" }]);
});

test("S7: V selects whole lines including empty ones", () => {
	const s = make(lines, { row: 1, col: 3 });
	const v = press(s, "V").state;
	assert.equal(v.mode, "visual-line");
	const r = press(v, "j", "j", "y");
	assert.deepEqual(r.effects, [{ type: "copy", text: "second line\n\nthird" }]);
	assert.equal(r.state.mode, "normal");
});

test("S7: yy copies the current line", () => {
	const r = press(make(lines, { row: 1, col: 4 }), "y", "y");
	assert.deepEqual(r.effects, [{ type: "copy", text: "second line" }]);
	assert.deepEqual(r.state.cursor, { row: 1, col: 4 });
});

test("S7: escape leaves visual mode without copying; v toggles off; V switches to linewise", () => {
	const s = make(lines, { row: 0 });
	const esc = press(s, "v", "l", "escape");
	assert.equal(esc.state.mode, "normal");
	assert.deepEqual(esc.effects, []);
	assert.equal(press(s, "v", "v").state.mode, "normal");
	assert.equal(press(s, "v", "V").state.mode, "visual-line");
	assert.equal(press(s, "V", "v").state.mode, "visual");
});
