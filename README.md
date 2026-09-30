# MacroLab

MacroLab is an independent Spindle extension for Lumiverse that turns reusable macro bodies into chat-scoped, rerollable state without forcing the user to leave the surface they are working in.

The 2.0 forge keeps the state engine and contextual tooling, but the product loop is now intentionally simple:

> **Build a macro → test it where you build it → insert it into a prompt → generate → control the committed choices in Chat State / Hot Plate.**

The drawer's native `?` guide contains the same five-minute tutorial as `docs/USAGE.md`.

## The three surfaces

### MacroLab drawer

The drawer has two primary destinations.

#### Library

Library is the authoring workspace:

- create and edit registered macros;
- inspect the detected **Recipe** of sticky `pick` / `random` decisions, including nesting;
- test the current unsaved draft in place;
- roll previews again without committing state;
- copy preview output;
- insert a saved macro into the last focused editable field.

There is no top-level Resolution tab anymore. Preview belongs to the macro being authored.

Draft preview uses a dedicated `macrolab:preview_macro` backend path. The current body is instrumented with MacroLab's sticky decision handlers and then resolved with `commit:false`, so preview behavior matches the eventual registered macro without creating new chat canon.

#### Chat State

Chat State is the committed runtime workspace. It groups decisions by macro + instance and supports:

- reroll one decision;
- undo the most recent reroll;
- lock/unlock;
- reset one decision;
- reroll all unlocked decisions in an instance;
- reset all unlocked decisions in an instance.

Rerolls affect subsequent macro resolution. They do **not** rewrite an already-generated assistant message.

Native local/chat/global variable editing still exists, but it now lives behind **Advanced variables** instead of occupying the primary workflow.

### Pipette

Pipette is the contextual editor surface. A compact launcher is mounted only where there is an actual macro-editable text surface.

Current forge mounts:

- World Book: `world_book_entry_editor`, at the top of an expanded entry;
- Loom block editing: `loom_block_editor_actions`, a dedicated compact action socket beside Back in the native block-editor header.

Prompt Variables intentionally has no Pipette launcher: its modal exposes variable controls rather than a macro-editable text surface.

Pipette can:

- detect macro references in the active field;
- distinguish registered, native, stochastic, and external references;
- insert registered macros;
- create missing MacroLab definitions;
- edit registered definitions in place;
- test a contextual draft before saving it.

Pipette scopes target discovery to the surface that launched it. A single local textarea can be inferred; otherwise focus the intended field first and Pipette fails closed rather than touching an unrelated editor.

### Hot Plate

Hot Plate is the compact runtime state surface. Its launcher lives on `chat_actions`, the composer action row, and shows a badge for committed decisions in the active chat.

Hot Plate exposes the same decision operations as Chat State, plus quick `+ New macro` and `Open MacroLab` actions.

## Five-minute tutorial

Create a macro named `origin`:

```text
Born {{pick::normally::from a ritual::from the sea}}.
```

Use **Test preview** in Library. The output is temporary: preview honors existing committed values but never writes new state.

Save it and insert:

```text
{{origin}}
```

into a Loom block or World Book entry. Generate normally. That committing resolve stores the chosen branch in the active chat.

Open Chat State / Hot Plate to see the committed value. Reroll it if you want future generations to use a different branch.

For independent state, use instances:

```text
{{origin::alice}}
{{origin::bob}}
```

See `docs/USAGE.md` for the full walkthrough.

## Macro syntax

A larger example:

```text
Born in {{pick::a storm-battered coastal city::a quiet mountain village::the imperial capital}}.

{{char}} was raised by {{pick::a family of scholars::a retired mercenary::an eccentric apothecary}}.

At age {{random::12::19}}, everything changed.
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

The old `__lml_state__` runtime namespace is intentionally not migrated.

## Stable decision ids

MacroLab does not use source-order `d0`, `d1`, `d2` identities as the primary state identity. Each stochastic node receives a context-derived id and a human label such as:

```text
Born in
Elara was raised by
At age
```

The id is derived from the node kind plus nearby static text and duplicate rank. Inserting a bare stochastic expression elsewhere therefore does not automatically renumber every later decision.

## Current boundary: message provenance

MacroLab currently knows active-chat state, not which specific assistant message consumed which decision revision. That means:

- state changes affect future resolutions;
- existing messages are not rewritten;
- message-level “this response used these decisions” UI is not faked;
- regenerate-after-reroll remains a future provenance feature.

## Compatibility

MacroLab 2 uses the clean `macrolab` extension identifier. Because Spindle storage is extension-scoped, the forge does not promise automatic migration of registry/state files from the old `lumi_macro_lab` prototype identity. Disable the old prototype before testing the forge so both extensions do not try to register the same macro names.

MacroLab 2 expects a host with the corrected macro bridge contract: host-trusted `chatId`, `volatile` forwarding, and non-committing dry-run prompt assembly.

## Build and verify

```bash
bun run check
bun run build
bun test
```

or:

```bash
bun run verify
```

Builds emit self-contained `dist/frontend.js` and `dist/backend.js` entry files. The modular TypeScript source remains under `src/`; the runtime entry artifacts are bundled during `bun run build`.

The harness models `ctx.env` as an immutable structured-clone snapshot and rejects mutating variable calls made from a `commit:false` macro invocation. It also verifies that `macrolab:preview_macro` fully resolves a draft without creating sticky state.

## Status

`2.0.0-alpha.4` is the usage-convergence forge build. The state engine, Library authoring, in-place draft preview, Recipe inspection, Chat State, Hot Plate, Pipette, native tutorial guide, and regression harness are present.

Message-level provenance and regenerate-after-reroll remain intentionally deferred until the host contract can support them honestly.

MacroLab is an independent, unofficial extension designed to interoperate with Lumiverse. It is not affiliated with, endorsed by, or supported by the Lumiverse project.
