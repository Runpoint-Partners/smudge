# Smudge

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Smudge" width="200" height="200" style="border-radius: 22px;">
</p>

A fork of [Scratch](https://github.com/erictli/scratch) — a minimalist, offline-first markdown note-taking app — with macOS file association support so it works as a default `.md` editor.

## What's different from Scratch

- **macOS file association** — Register as an editor for `.md` files. Double-click any markdown file in Finder to open it in Smudge. Handles both cold-start (launch arguments) and warm-start (Opened events) file opens with robust fallback polling.
- **Drag-and-drop** — Drag `.md` files onto the app window or the dock icon to open them.
- **Auto-import to notes folder** — External files opened via file association or drag-and-drop are automatically copied into your notes folder so they're discoverable in the sidebar.
- **Full edit and save** — External files get the same WYSIWYG editor and auto-save as notes in your folder.
- **Multi-select in note list** — Shift-click for range selection, Cmd/Ctrl-click for individual toggle. Bulk delete via context menu or Delete/Backspace key.
- **Quarantine handling** — Automatically strips macOS Gatekeeper quarantine attributes so downloaded `.md` files open without issues.
- **Patched tao dependency** — Vendored `tao` crate to fix macOS file-open event handling for Tauri v2.
- **Renamed** — All branding, identifiers, and config paths updated from Scratch to Smudge.

Everything else from Scratch is preserved: offline-first storage, markdown-based notes, WYSIWYG editing, full-text search, git integration, AI editing via Claude Code CLI, and theme customization.

## Installation

### From Source

**Prerequisites:** Node.js 18+, Rust 1.70+, Xcode Command Line Tools (macOS)

```bash
git clone https://github.com/Runpoint-Partners/smudge.git
cd smudge
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

After building, copy `src-tauri/target/release/bundle/macos/Smudge.app` to `/Applications/`.

To avoid Gatekeeper warnings on the app itself:

```bash
xattr -cr /Applications/Smudge.app
codesign --force --deep --sign - /Applications/Smudge.app
```

## Built With

[Tauri](https://tauri.app/) · [React](https://react.dev/) · [TipTap](https://tiptap.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Tantivy](https://github.com/quickwit-oss/tantivy)

## License

MIT
