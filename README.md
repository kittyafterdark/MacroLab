# MacroLab

MacroLab is an independent Spindle extension for Lumiverse that turns reusable macro bodies into chat-scoped, rerollable state without forcing the user to leave the surface they are working in.

This is the 2.0 forge rewrite. The old UI was treated as a prototype; the registered-macro syntax and useful registry behavior were retained, while sticky state and the frontend were rebuilt around the corrected Spindle macro contract.

## The three surfaces

### MacroLab

The full drawer is the workshop. It contains:

- registered macro authoring and editing;
- a real `commit:false` Resolution preview;
- a raw state inspector with stable decision ids and revisions;
- native local/chat/global variable editing for debugging.

### Pipette

Pipette is the contextual editor surface. A compact MacroLab launcher is mounted into supported editor toolbars. When opened, Pipette samples the last focused editable field and shows:

- every macro reference detected in that field;
- which references are registered MacroLab macros;
- which are inline `pick`/`random` nodes;
- registered macro decision counts;
- one-click insertion of registered macros;
- a jump back to the full MacroLab definition editor.

Current forge mounts:

- `world_book_entry_toolbar`
- `preset_editor_toolbar`
- `loom_builder_toolbar`
- `prompt_variables_toolbar`

Pipette deliberately refuses to guess when several text editors are visible and none has been focused. Focus the field first, then open Pipette.

### Hot Plate

Hot Plate is the runtime chat-state surface. Its launcher lives at `chat_input_tools_right` and shows a badge for committed decisions in the active chat.

Hot Plate groups decisions by macro + instance and supports:

- reroll one decision;
- undo the most recent reroll;
- lock/unlock;
- reset one decision;
- reroll all unlocked decisions in an instance;
- reset all unlocked decisions in an instance.

Rerolls affect subsequent macro resolution. They do not rewrite an already-generated assistant message.

## Macro syntax

Register a macro named `backstory` with a body such as:

```text
Born in {{pick::a storm-battered coastal city::a quiet mountain village::the imperial capital}}.

{{char}} was raised by {{pick::a family of scholars::a retired mercenary::an eccentric apothecary}}.

At age {{random::12::19}}, everything changed.
```

Use it anywhere the host resolves macros:

```text
{{backstory}}
```

or give it an independent instance:

```text
{{backstory::alice}}
{{backstory::bob}}
```

Nested `pick` and `random` nodes inside a registered MacroLab body become sticky decisions. Normal inline `{{pick}}` / `{{random}}` expressions outside a registered MacroLab body remain native host macros and are not claimed by MacroLab.

## Sticky-state semantics

MacroLab 2 owns its state directly through `spindle.variables.chat`.

- `ctx.chatId` is the authoritative chat identity for a macro invocation.
- `ctx.commit !== false` may create or refresh missing sticky state.
- `ctx.commit === false` may read existing sticky state but never writes new state.
- Preview/dry-run evaluation therefore cannot accidentally create canon.
- Registered and internal stateful macros are declared `volatile: true`.

The v2 decision namespace is:

```text
__macrolab_v2__...
```

The old `__lml_state__` runtime namespace is intentionally not migrated. Within the new MacroLab identity, definitions use the familiar `macro-registry.json` format. Prototype sticky choices start fresh under v2; old prototype storage is not automatically imported across the identifier boundary.

## Stable decision ids

MacroLab no longer exposes source-order ids such as `d0`, `d1`, `d2` as the primary UI identity. Each stochastic node receives a context-derived id and a human label such as:

```text
Born in
Elara was raised by
At age
```

The id is derived from the node kind plus nearby static text and duplicate rank. Inserting a bare stochastic expression elsewhere therefore does not automatically renumber every later decision. Editing the surrounding prose can intentionally produce a new identity; this is preferable to silently binding old canon to a semantically different sentence.

## Compatibility

MacroLab 2 uses a clean `macrolab` extension identifier. Because Spindle storage is extension-scoped, the forge does not promise automatic migration of registry/state files from the old `lumi_macro_lab` prototype identity. The old prototype should be disabled before testing the forge so both extensions do not try to register the same macro names.

MacroLab 2 expects a host with the corrected macro bridge contract: host-trusted `chatId`, `volatile` forwarding, and non-committing dry-run prompt assembly.

## Build and verify

```bash
bun run check
bun run build
bun test
```

or simply:

```bash
bun run verify
```

The scripts are runtime-neutral enough to work through npm as well; Bun is the expected workflow for the forge.

The harness models `ctx.env` as an immutable structured-clone snapshot and rejects mutating variable calls made from a `commit:false` macro invocation. That is intentional: a test must not accidentally recreate the permissive fake environment that hid the v1 architecture bug.

## Icons

`assets/icons/source/` contains the four canonical user-authored SVGs:

- beaker
- lab coat
- pipette
- hot plate

`assets/icons/ui/` contains theme-ready derivatives with the white traced background removed and the artwork mapped to `currentColor`. All variants retain the same normalized bracket frame and optical canvas.

## Status

`2.0.0-alpha.1` is a forge build. The state engine, Hot Plate, Pipette, full MacroLab drawer, definition migration, and regression harness are present. Message-level provenance, source-aware lorebook names, richer host workspaces, and regenerate-after-reroll are intentionally left for subsequent welds rather than guessed into the first rewrite.

MacroLab is an independent, unofficial extension designed to interoperate with Lumiverse. It is not affiliated with, endorsed by, or supported by the Lumiverse project.
