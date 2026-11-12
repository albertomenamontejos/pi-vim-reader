# gentle-vim-reader

A read-only, vim-style reader for the whole Gentle Shell (Pi) conversation.

Press `alt+v` to open a full-screen view of the conversation with a cursor. Move, search, select and copy with vim keys, open links and files, then press `Esc` or `q` to return to the editor. The reader never edits anything.

The reader looks like the chat: it shows the chat's own rendered lines (colors, boxes, Markdown, wrapping) and only paints the cursor, the selection and search matches on top.

The view is live: with the cursor on the last line it follows the agent's output as it streams (`FOLLOW` in the status line). Move up and the text stays where it is; press `G` to follow again.

## Keys

| Group | Keys |
|---|---|
| Move | `h j k l`, `w b e`, `0 $`, `gg G`, `Ctrl+d` / `Ctrl+u` |
| Messages | `]]` next message, `[[` previous message |
| Search | `/` forward, `?` backward, `n` / `N` repeat (smartcase, wraps around) |
| Select and copy | `v` charwise, `V` linewise, then `y`; `yy` copies the current line |
| Code blocks | `yc` copies the fenced code block under the cursor, without the fences |
| Links and files | `gx` opens the URL under the cursor, `gf` opens the file path (`path` or `path:line`) |
| Follow | `G` jumps to the last line and follows live output |
| Close | `Esc` or `q` |

Copy uses the system clipboard (wl-copy, xclip or xsel), with an OSC 52 fallback. Open uses `xdg-open` on Linux, `open` on macOS and `start` on Windows.

## Install

Requires Gentle Shell (or Pi) with extension support.

Clone the repository, then add its path to the `packages` array in `~/.gentle-shell/agent/settings.json`:

```json
{
  "packages": ["/path/to/gentle-vim-reader"]
}
```

Restart Gentle Shell and press `alt+v`.

Pi loads `src/extension.ts` through the `pi.extensions` field in `package.json`. No build step and no dependencies are needed: `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent` are provided by the host at load time.

## Development

```sh
npm test   # node --test test/
```

- `src/core/` — pure reader state machine: cursor, motions, search, selection, follow.
- `src/transcript/` — turns Pi session entries into plain-text lines (fallback view).
- `src/ui/styled.ts` — reads the chat's own styled lines and strips them to plain text for the core.
- `src/ui/` — key normalization, painting, actions, the overlay component and its controller.
- `src/extension.ts` — thin Pi entry point.

Tests run on Node 22.6+ with built-in TypeScript type stripping (Node 23.6+ without flags).

## Known limits

- Pi has no public API for the rendered chat. The reader finds Pi's chat container inside the TUI's mounted components (Pi 1.5.2 layout). If a Pi update changes that layout, or the chat cannot be rendered, the reader falls back to its own plain-text view built from the session: same keys, but plain wrapping and no chat styling.
- Motions, search, `yy`, `yc`, `gx` and `gf` work on the visible text of the chat lines. Text wrapped by the chat (long URLs, paths) is split across lines, and `yc` copies code lines with the chat's indentation.
- Inline images show as `[image]`.
- With Pi's scrollbar setting `always`, the chat is one column narrower than the reader, so wrapping can differ by one column.
- `gf` opens the file but does not jump to the line.
- On Windows/WSL, `alt+v` is Pi's built-in paste-image key.

## Gentle Hub

This repository is listed on [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/) through the GitHub topics `gentle-shell-package` and `gentle-shell-extension`.

## License

MIT
