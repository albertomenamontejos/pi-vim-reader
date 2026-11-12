// Geometry of the chat region, so the reader can cover only the chat and leave
// Gentle Shell's header, rail, prompt and status bar visible.
//
// Pi has no public API for this. pi-tui's alt-screen keeps the last layout in the
// private `currentLayout` (box tree with `rect` and `scrollView`), and
// `getPrimaryScrollView()` returns the chat viewport. Everything here is defensive:
// any unknown shape yields the full-screen region and never throws.

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Terminal {
	rows: number;
	columns: number;
}

export interface Region {
	top: number;
	left: number;
	right: number;
	bottom: number;
	rows: number;
	columns: number;
}

/** The slice of pi-tui's ScrollView the reader reads. */
export interface ScrollLike {
	scrollTop: number;
	contentHeight: number;
	viewportHeight: number;
	isFollowingEnd?: boolean;
}

const MIN_COLUMNS = 20;
const MIN_ROWS = 3;

export function fullScreen(term: Terminal): Region {
	return { top: 0, left: 0, right: 0, bottom: 0, rows: term.rows, columns: term.columns };
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** Margins and size of `rect` inside the terminal; the full screen when the rect is unknown or implausible. */
export function regionFromRect(rect: Rect | undefined, term: Terminal): Region {
	if (!rect || !isInt(rect.x) || !isInt(rect.y) || !isInt(rect.width) || !isInt(rect.height)) return fullScreen(term);
	const right = term.columns - rect.x - rect.width;
	const bottom = term.rows - rect.y - rect.height;
	if (rect.x < 0 || rect.y < 0 || right < 0 || bottom < 0) return fullScreen(term);
	if (rect.width < MIN_COLUMNS || rect.height < MIN_ROWS) return fullScreen(term);
	return { top: rect.y, left: rect.x, right, bottom, rows: rect.height, columns: rect.width };
}

/** Rect of `scrollView` in a pi-tui layout frame (`{ root: { rect, scrollView?, children } }`). */
export function findScrollRect(layout: unknown, scrollView: unknown): Rect | undefined {
	try {
		const visit = (box: any): Rect | undefined => {
			if (!box || typeof box !== "object") return undefined;
			if (box.scrollView === scrollView) return box.rect;
			if (Array.isArray(box.children)) {
				for (const child of box.children) {
					const found = visit(child);
					if (found) return found;
				}
			}
			return undefined;
		};
		return visit((layout as { root?: unknown } | undefined)?.root);
	} catch {
		return undefined;
	}
}

/** The chat region of `tui`, or the full screen when it cannot be determined. */
export function chatRegion(tui: any): Region {
	const term: Terminal = { rows: tui.terminal.rows, columns: tui.terminal.columns };
	try {
		const scrollView = typeof tui.getPrimaryScrollView === "function" ? tui.getPrimaryScrollView() : tui.currentLayout?.primaryScrollView;
		if (!scrollView) return fullScreen(term);
		return regionFromRect(findScrollRect(tui.currentLayout, scrollView), term);
	} catch {
		return fullScreen(term);
	}
}

/** The chat's scroll view, when reachable. */
export function chatScroll(tui: any): ScrollLike | undefined {
	try {
		const sv = typeof tui.getPrimaryScrollView === "function" ? tui.getPrimaryScrollView() : tui.currentLayout?.primaryScrollView;
		return sv ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Buffer row at the top of the chat's current viewport, or null when the chat is
 * following the end (or the scroll state is unreadable): the reader then starts
 * on the last line. The chat lines are the last part of the scrolled content, so
 * the lines above them (header, resources) are `contentHeight - lineCount`.
 */
export function scrollStart(scroll: ScrollLike | undefined, lineCount: number): number | null {
	if (!scroll || lineCount <= 0) return null;
	const { scrollTop, contentHeight, viewportHeight } = scroll;
	if (![scrollTop, contentHeight, viewportHeight].every((n) => Number.isFinite(n))) return null;
	if (scroll.isFollowingEnd === true) return null;
	if (scrollTop >= Math.max(0, contentHeight - viewportHeight)) return null;
	const row = Math.max(0, Math.floor(scrollTop - (contentHeight - lineCount)));
	return Math.min(row, lineCount - 1);
}

/** Write `region` into the overlay options object in place; true when anything changed. */
export function applyMargin(options: Record<string, any>, region: Region): boolean {
	const margin = { top: region.top, right: region.right, bottom: region.bottom, left: region.left };
	const m = options.margin;
	const same =
		options.anchor === "top-left" &&
		options.width === region.columns &&
		options.maxHeight === region.rows &&
		m && typeof m === "object" && m.top === margin.top && m.right === margin.right && m.bottom === margin.bottom && m.left === margin.left;
	if (same) return false;
	options.anchor = "top-left";
	options.width = region.columns;
	options.maxHeight = region.rows;
	options.margin = margin;
	return true;
}
