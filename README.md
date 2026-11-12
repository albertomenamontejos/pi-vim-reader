# gentle-vim-reader

A read-only, vim-style reader for the whole Gentle Shell (Pi) conversation.

Press `alt+v` to open a full-screen view of the conversation with a cursor. Move, search, select and copy with vim keys, open links and files, then press `Esc` or `q` to return to the editor. The reader never edits anything.

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
- `src/transcript/` — turns Pi session entries into plain-text lines.
- `src/ui/` — key normalization, painting, actions, the overlay component and its controller.
- `src/extension.ts` — thin Pi entry point.

Tests run on Node 22.6+ with built-in TypeScript type stripping (Node 23.6+ without flags).

## Known limits

- The reader is its own view, so wrapping and Markdown styling differ from the chat.
- `gf` opens the file but does not jump to the line.
- On Windows/WSL, `alt+v` is Pi's built-in paste-image key.

## Gentle Hub

This repository is listed on [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/) through the GitHub topics `gentle-shell-package` and `gentle-shell-extension`.

## License

MIT
