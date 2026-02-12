# Smudge

A fork of [Scratch](https://github.com/erictli/scratch) — a minimalist, offline-first markdown note-taking app — with macOS file association support so it works as a default `.md` editor.

## What's different from Scratch

- **macOS file association** — Register as an editor for `.md` files. Double-click any markdown file in Finder to open it in Smudge.
- **Drag-and-drop** — Drag `.md` files onto the app window or the dock icon to open them.
- **Open without a notes folder** — Smudge can open individual `.md` files even if you haven't configured a notes folder yet.
- **Full edit and save** — External files get the same WYSIWYG editor and auto-save as notes in your folder.
- **Quarantine handling** — Automatically strips macOS Gatekeeper quarantine attributes so downloaded `.md` files open without issues.
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
