# pi-vim-reader

A read-only, vim-style reader for the whole Gentle Shell (Pi) conversation.

Press `alt+v` to open a vim-style cursor over the chat. The reader covers only the chat area: the header, the right rail, the prompt and the status bar stay visible and in place. It opens where the chat is scrolled (or on the last line, following, when the chat is at the bottom). Move, search, select and copy with vim keys, open links and files, then press `q` to return to the editor. The reader never edits anything.

The reader looks like the chat: it shows the chat's own rendered lines (colors, boxes, Markdown, wrapping) and only paints the cursor, the selection and search matches on top.

The view is live: with the cursor on the last line it follows the agent's output as it streams (`FOLLOW` in the status line). Move up and the text stays where it is; press `G` to follow again.

## Keys

| Group | Keys |
|---|---|
| Move | `h j k l`, `w b e`, `0 $`, `gg G`, `Ctrl+d` / `Ctrl+u` |
| Messages | `]]` next message, `[[` previous message; `Alt+j` / `Alt+k` jump to the next / previous message you sent (assistant and tool messages are skipped); `Alt+j` on your last message goes to the end of the page |
| Search | `/` forward, `?` backward, `n` / `N` repeat (smartcase, wraps around) |
| Select and copy | `v` charwise, `V` linewise, then `y`; `yy` copies the current line |
| Code blocks | `yc` copies the fenced code block under the cursor, without the fences |
| Links and files | `gx` opens the URL under the cursor, `gf` opens the file path (`path` or `path:line`) in `$VISUAL`/`$EDITOR` (for example vim or nvim) at that line, then returns to the reader |
| Expand | `Ctrl+o` expands or collapses the tool-output block under the cursor (like clicking it); on a line without such a block it toggles all tool output, as Pi's own `Ctrl+o` does |
| Follow | `G` jumps to the last line and follows live output; closing with `q` while following leaves the chat scrolled to the bottom |
| Close | `q`, also from visual mode (`Esc` only leaves visual mode or search; it never closes, so a double `Esc` cannot abort the running agent) |

Copy uses the system clipboard (wl-copy, xclip or xsel), with an OSC 52 fallback. `gx` (and `gf` when no editor is set) uses `xdg-open` on Linux, `open` on macOS and `start` on Windows.

## Changing the open key

`alt+v` is only the default. The extension registers the slash command `/vim-reader`:

| Command | Effect |
|---|---|
| `/vim-reader` | opens the reader |
| `/vim-reader bind alt+r` | binds another key (a ctrl, alt or super combination, or f1-f12) |
| `/vim-reader unbind` | disables the key binding (the command still works) |
| `/vim-reader reset` | back to the default `alt+v` |

After `bind`, `unbind` or `reset`, run `/reload` to apply it.

How it works: Gentle Shell runs any `command:<name>` binding found in its `keymaps.json` (for a bundled Gentle Shell: `<prefix>/config/gentle-ai/keymaps.json`, e.g. `~/.gentle-shell/config/gentle-ai/keymaps.json`). `bind` writes `"command:vim-reader": "<key>"` there, keeping every other binding. The file is written atomically with mode 600. A malformed file is never overwritten, and keys that would break typing (plain letters, Enter, shift+letter) or that clash with another binding or a Gentle Shell default (for example `alt+k`) are refused. At load the extension reads the file: with a key assigned (or disabled), the built-in `alt+v` is not registered; with nothing assigned, or if the file cannot be read, `alt+v` stays.

Known limits:
- `/vim-reader` does **not** appear in `/gentle:customize` → Keymaps. Gentle Shell lists only the commands of its own built-in catalog (gentle-pi 4.7.0, `lib/command-palette-catalog.ts`), so a third-party command cannot add a row there.
- The extension edits a file that belongs to Gentle Shell and mirrors its schema (`schema: 1`) and key rules. If a Gentle Shell update changes them, `bind` may stop working; deleting the `command:vim-reader` entry always restores `alt+v`.
- It trusts `GENTLE_SHELL_PREFIX`: if that variable points at something that is not a real bundled Gentle Shell install, Gentle Shell reads another folder and `bind` would write a file it never reads.
- Clash checks cover Gentle Shell's defaults at the time of writing and the keys already in `keymaps.json`, not every Pi binding. Pi's reserved keys (ctrl+c, ctrl+d, ctrl+o and similar) are refused; other Pi bindings are overridden with a warning from Pi when loading.

## Install

Requires Gentle Shell (or Pi) with extension support.

```sh
# Gentle Shell
gentle-shell install npm:pi-vim-reader

# Pi
pi install npm:pi-vim-reader
```

Restart Gentle Shell and press `alt+v`.

### From a local clone

Clone the repository, then add its path to the `packages` array in `~/.gentle-shell/agent/settings.json`:

```json
{
  "packages": ["/path/to/pi-vim-reader"]
}
```

Pi loads `src/extension.ts` through the `pi.extensions` field in `package.json`. No build step and no dependencies are needed: `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent` are provided by the host at load time.

## Contributing

Issues and pull requests are welcome. Run `npm test` before sending a change; behavior changes should come with a test. Released under the MIT License (see `LICENSE`).

This is my first open source project, so feedback is very welcome. If something is unclear or broken, please open an issue.

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

- The chat region is read from pi-tui's private layout (the chat viewport's rectangle and scroll position, Pi 1.5.2). If it cannot be read, the reader covers the whole terminal and starts on the last line.
- Pi has no public API for the rendered chat. The reader finds Pi's chat container inside the TUI's mounted components (Pi 1.5.2 layout). If a Pi update changes that layout, or the chat cannot be rendered, the reader falls back to its own plain-text view built from the session: same keys, but plain wrapping and no chat styling.
- Motions, search, `yy`, `yc`, `gx` and `gf` work on the visible text of the chat lines. Text wrapped by the chat (long URLs, paths) is split across lines, and `yc` copies code lines with the chat's indentation.
- Inline images show as `[image]`.
- With Pi's scrollbar setting `always`, the chat is one column narrower than the reader, so wrapping can differ by one column.
- `gf` runs the editor in the foreground and suspends Gentle Shell until it exits, as Gentle Shell's own external editor does. Without `$VISUAL` or `$EDITOR` it falls back to `xdg-open`, which does not jump to the line.
- On Windows/WSL, `alt+v` is Pi's built-in paste-image key.

## Gentle Hub

This repository carries the GitHub topics `gentle-shell-package` and `gentle-shell-extension`, which is how [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/) discovers community packages.

## License

MIT
