import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMargin, findScrollRect, regionFromRect, scrollStart } from "../../src/ui/geometry.ts";

const term = { rows: 40, columns: 120 };

test("regionFromRect: the chat rect becomes margins, rows and columns", () => {
	const r = regionFromRect({ x: 3, y: 2, width: 100, height: 30 }, term);
	assert.deepEqual(r, { top: 2, left: 3, right: 17, bottom: 8, rows: 30, columns: 100 });
});

test("regionFromRect: unknown, tiny or out-of-bounds rects fall back to the full screen", () => {
	const full = { top: 0, left: 0, right: 0, bottom: 0, rows: 40, columns: 120 };
	assert.deepEqual(regionFromRect(undefined, term), full);
	assert.deepEqual(regionFromRect({ x: 0, y: 0, width: 5, height: 30 }, term), full);
	assert.deepEqual(regionFromRect({ x: 0, y: 0, width: 100, height: 1 }, term), full);
	assert.deepEqual(regionFromRect({ x: 50, y: 0, width: 100, height: 30 }, term), full);
	assert.deepEqual(regionFromRect({ x: 0, y: 10, width: 100, height: 40 }, term), full);
	assert.deepEqual(regionFromRect({ x: 0, y: 0, width: Number.NaN, height: 30 }, term), full);
});

test("findScrollRect: walks nested layout boxes and returns the scroll view's rect", () => {
	const sv = {};
	const rect = { x: 1, y: 2, width: 60, height: 20 };
	const layout = {
		root: {
			rect: { x: 0, y: 0, width: 120, height: 40 },
			children: [{ rect: { x: 0, y: 0, width: 70, height: 40 }, children: [{ rect, scrollView: sv, children: [] }] }],
		},
	};
	assert.deepEqual(findScrollRect(layout, sv), rect);
	assert.equal(findScrollRect(layout, {}), undefined);
	assert.equal(findScrollRect(undefined, sv), undefined);
	assert.equal(findScrollRect({ root: null }, sv), undefined);
});

test("scrollStart: null at the bottom or following, otherwise the first visible chat line", () => {
	// content = 10 lines of header/resources + 90 chat lines, viewport 30
	const sv = (scrollTop: number, following = false) => ({ scrollTop, contentHeight: 100, viewportHeight: 30, isFollowingEnd: following });
	assert.equal(scrollStart(sv(70), 90), null, "at the bottom");
	assert.equal(scrollStart(sv(10, true), 90), null, "following the end");
	assert.equal(scrollStart(sv(40), 90), 30, "scrollTop minus the lines above the chat");
	assert.equal(scrollStart(sv(4), 90), 0, "inside the header clamps to the first line");
	assert.equal(scrollStart(undefined, 90), null);
	assert.equal(scrollStart({ scrollTop: Number.NaN, contentHeight: 100, viewportHeight: 30 }, 90), null);
});

test("applyMargin mutates the options object in place and reports changes", () => {
	const options: Record<string, unknown> = {};
	const region = { top: 1, left: 0, right: 53, bottom: 4, rows: 35, columns: 67 };
	assert.equal(applyMargin(options, region), true);
	assert.deepEqual(options, { anchor: "top-left", width: 67, maxHeight: 35, margin: { top: 1, right: 53, bottom: 4, left: 0 } });
	assert.equal(applyMargin(options, region), false);
	assert.equal(applyMargin(options, { ...region, bottom: 5, rows: 34 }), true);
	assert.equal((options.margin as any).bottom, 5);
	assert.equal(options.maxHeight, 34);
});
