# Patch manifest — usage convergence

Full cumulative MacroLab source, based on the previous no-Prompt-Variables-Pipette forge.

## UX convergence

- `src/frontend.ts`
  - collapses the drawer from `Macros | Resolution | State` to `Library | Chat State`;
  - moves preview into the macro authoring form;
  - adds a detected Recipe view with nesting-aware sticky-decision rows;
  - adds one-click Test from registered macro cards;
  - gives Pipette's contextual macro editor its own draft preview;
  - makes preview-vs-commit semantics explicit in UI copy;
  - moves native local/chat/global variables under `Advanced variables`;
  - rewrites empty states around the actual usage loop;
  - registers a native Spindle drawer guide with a five-minute tutorial.
- `src/backend.ts` + `src/shared/protocol.ts`
  - add `macrolab:preview_macro`, which instruments the unsaved draft with MacroLab decision handlers and resolves it with `commit:false`.
- `tests/harness.mjs`
  - proves draft preview fully resolves while persisting zero new decision state.
- `tests/frontend-surface-contract.mjs`
  - guards the two-tab information architecture, in-place preview, tutorial guide, and Advanced variables disclosure in addition to the existing mount contracts.
- `docs/USAGE.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/SURFACES.md`, `CHANGELOG.md`
  - document the converged product loop and current provenance boundary.
- `package.json`, `spindle.json`
  - bump the forge to `2.0.0-alpha.4`.

Existing Pipette/Hot Plate mount contracts remain unchanged: `world_book_entry_editor`, `loom_block_editor_actions`, and `chat_actions`. The general `loom_builder_toolbar` is still untouched.
