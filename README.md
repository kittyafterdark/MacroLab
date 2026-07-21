# Lumi Macro Lab

A tiny Lumiverse Spindle extension for previewing macro resolution without saving the input, output, or macro side effects.

## What it does

- Adds a **Macro Lab** drawer tab.
- Resolves pasted Lumiverse macros against the currently active chat when one is available.
- Uses a dry, non-committing resolve.
- Shows macro diagnostics with approximate line and column locations.
- Keeps all editor text only in the current browser DOM. Reloading the page or disabling the extension clears it.

## Install

Install the repository URL from Lumiverse's Extensions panel, or upload an archive containing `spindle.json` at its root.

## Development

```bash
npm install
npm run build
```

The compiled files are committed in `dist/`, so the extension can be installed without building locally.

## Usage

Open **Macro Lab** from the drawer or command palette, paste a prompt, then press **Resolve**. `Ctrl+Enter` or `Cmd+Enter` also resolves. **Clear** removes the current DOM-only draft and output.
