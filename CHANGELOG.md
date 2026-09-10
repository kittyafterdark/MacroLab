# Changelog

## 2.0.0-alpha.3 — Contextual surface weld

### Surface UX

- Moves the Hot Plate launcher to `chat_toolbar`, with `chat_input_tools_right` retained only as a fail-closed fallback when the toolbar mount is unavailable.
- Prefers `lorebook_workspace` for the World Book Pipette launcher, falling back to `world_book_entry_toolbar` for hosts/layouts that do not expose the workspace mount.
- Replaces DOM-flavored `textarea` / `text field` labels with semantic surface copy such as `World Book entry · Content`.
- Pipette now preserves registered macro instances such as `backstory · dan` instead of collapsing every invocation to the macro name.
- Pipette can create missing MacroLab definitions directly from an unregistered reference, create-and-insert a new macro, and edit registered definitions without bouncing through the drawer.

### Native variables

- Tracks variables explicitly created through MacroLab separately from variables discovered from presets, other extensions, or host state.
- Keeps MacroLab-authored variables expanded and places external/discovered variables in collapsed `Other <scope> variables` drawers with counts.
- Editing an external variable does not claim ownership. Deleting one now requires confirmation because another system may depend on it.
- Ownership metadata is extension storage only; MacroLab does not rename or wrap native host variables.

## 2.0.0-alpha.2 — Self-contained Spindle entries

### Packaging

- Bundles the frontend entry and all of its local runtime dependencies into a single `dist/frontend.js`.
- Bundles the backend entry and its local runtime dependencies into a single `dist/backend.js`.
- Removes relative runtime imports from both Spindle entry files so blob/data URL loading does not depend on a hierarchical module base.
- Build output now compiles to a temporary `.build/` tree, emits the two self-contained Spindle entries, then removes the temporary tree.
- Adds a packaging guard that refuses unexpected non-relative runtime imports instead of silently producing a broken extension archive.

## 2.0.0-alpha.1 — Forge rewrite

### State engine

- Replaced the v1 cloned-environment / nested-`setchatvar` persistence path with direct `spindle.variables.chat` persistence.
- Uses host-trusted macro invocation `chatId` as the primary chat identity.
- Honors `ctx.commit`: non-committing resolution can reuse existing state but never creates or refreshes it.
- Moves sticky runtime state to the new `__macrolab_v2__` namespace.
- Starts under the clean `macrolab` extension identity and intentionally abandons prototype v1 sticky state.
- Retains the `macro-registry.json` registry format inside the new extension identity, without pretending Spindle can transparently migrate isolated storage across identifiers.
- Keeps all registered and internal stateful macro definitions `volatile: true`.

### Decisions

- Replaced source-order `d0`/`d1` identities with context-derived stable ids.
- Added human-readable decision labels and source previews.
- Added per-decision revision numbers and bounded reroll history.
- Added Undo.
- Centralized reroll, lock/unlock, reset, bulk reroll, and bulk reset behavior.

### UI

- Renamed the visible extension from Lumi Macro Lab to MacroLab.
- Rebuilt the full drawer as MacroLab with Macros, Resolution, and State surfaces.
- Added Hot Plate at `chat_input_tools_right` for runtime committed state.
- Added Pipette launchers to World Book, preset, Loom builder, and prompt-variable toolbars.
- Added focus-aware contextual macro scanning and registered-macro insertion from Pipette.
- Added the normalized beaker / coat / pipette / hot-plate SVG family.

### Tests

- Replaced the permissive v1 harness model with a bridge-faithful environment snapshot.
- The harness rejects state mutation from `commit:false` macro invocations.
- Added coverage for authoritative `chatId`, sticky reuse, dry runs, reroll/undo/lock/reset, nested macros, definition stability, operator-user isolation, volatile registration, and v2 metadata.
