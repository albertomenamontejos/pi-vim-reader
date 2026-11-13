import { createReader, handleKey } from "../../src/core/index.ts";
import type { Effect, ReaderState } from "../../src/core/index.ts";

export function make(lines: string[], opts: { meta?: number[]; userMessages?: boolean[]; height?: number; row?: number; col?: number } = {}): ReaderState {
	let state = createReader(lines, { meta: opts.meta, userMessages: opts.userMessages, height: opts.height ?? 10, follow: false });
	if (opts.row !== undefined || opts.col !== undefined) {
		state = { ...state, cursor: { row: opts.row ?? 0, col: opts.col ?? 0 }, following: false };
	}
	return state;
}

export function press(state: ReaderState, ...keys: string[]): { state: ReaderState; effects: Effect[] } {
	const effects: Effect[] = [];
	let s = state;
	for (const key of keys) {
		const result = handleKey(s, key);
		s = result.state;
		if (result.effect) effects.push(result.effect);
	}
	return { state: s, effects };
}

export function typeKeys(text: string): string[] {
	return [...text];
}
