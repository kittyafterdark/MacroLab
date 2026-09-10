# Changelog

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
