// Normalize raw terminal input into the key tokens understood by the reader core.
// Pure: pi-tui's decoders are injected by the extension; raw bytes are decoded here
// as a fallback so the logic is testable without Pi.

export interface KeyHelpers {
	/** pi-tui `decodeKittyPrintable`: printable character from a Kitty CSI-u sequence. */
	decodePrintable?(data: string): string | undefined;
	/** pi-tui `parseKey`: key id such as "ctrl+d", "escape", "shift+g". */
	parseKey?(data: string): string | undefined;
}

const RAW: Record<string, string> = {
	"\x1b": "escape",
	"\r": "enter",
	"\n": "enter",
	"\x7f": "backspace",
	"\x08": "backspace",
	"\x04": "ctrl+d",
	"\x15": "ctrl+u",
	"\x0f": "ctrl+o",
	" ": "space",
	"\x1b[A": "up",
	"\x1b[B": "down",
	"\x1b[C": "right",
	"\x1b[D": "left",
	"\x1bOA": "up",
	"\x1bOB": "down",
	"\x1bOC": "right",
	"\x1bOD": "left",
	"\x1b[H": "home",
	"\x1b[F": "end",
};

function printableToken(ch: string): string {
	return ch === " " ? "space" : ch;
}

function isPrintable(ch: string): boolean {
	const cp = ch.codePointAt(0) ?? 0;
	return cp >= 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp < 0xa0);
}

/** Map one chunk of terminal input to zero or more core key tokens. */
export function normalizeKey(data: string, helpers: KeyHelpers = {}): string[] {
	if (data === "") return [];
	const printable = helpers.decodePrintable?.(data);
	if (printable !== undefined && [...printable].length === 1) return [printableToken(printable)];

	const chars = [...data];
	if (chars.length === 1 && isPrintable(data)) return [printableToken(data)];

	const parsed = helpers.parseKey?.(data);
	if (parsed !== undefined) {
		const shifted = /^shift\+([a-z])$/.exec(parsed);
		if (shifted) return [shifted[1]!.toUpperCase()];
		return [parsed];
	}

	const raw = RAW[data];
	if (raw !== undefined) return [raw];

	// Pasted plain text (e.g. into a search prompt): one token per character.
	if (chars.length > 1 && chars.every(isPrintable)) return chars.map(printableToken);
	return [];
}
