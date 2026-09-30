# MacroLab 2 architecture

MacroLab is split conceptually into three layers even though the runtime stays compact.

## 1. Resolution and decision graph

`src/core/decision-graph.ts` is host-agnostic. It finds stochastic nodes, derives human labels, computes context-derived decision identities, scans arbitrary macro references for Pipette, and instruments registered macro bodies with MacroLab's internal sticky handlers.

The graph does not persist anything and does not know about chat ids.

The frontend reuses the same graph scanner for the Library **Recipe** view. That keeps authoring feedback aligned with the backend rather than inventing a second parser in the UI.

## 2. State model and operations

`src/core/state.ts` defines the v2 persisted representation and serialization rules. Runtime state is intentionally small: the registered macro definition remains the source of structure while the chat store contains only committed decision state and enough recipe metadata to reroll safely.

A decision stores:

- macro + instance identity;
- stable decision id;
- human label/source preview;
- kind and current value;
- lock state;
- recipe snapshot (`options` or `args`);
- timestamps/revision;
- bounded reroll history.

`src/backend.ts` is the only layer that talks to host persistence. All UI operations route through the same backend operations rather than implementing rerolls independently per surface.

### Draft preview

`macrolab:preview_macro` exists specifically for authoring. The backend instruments the current unsaved body with MacroLab's sticky handlers, then resolves it with `commit:false`. This makes Library/Pipette previews faithful to the eventual registered macro behavior without allowing a test roll to create canon.

## 3. Surfaces

`src/frontend.ts` presents the same engine in three densities:

- **MacroLab → Library**: definition authoring, Recipe inspection, and in-place non-committing preview.
- **MacroLab → Chat State**: committed macro decisions first; native variables live behind an Advanced disclosure.
- **Pipette**: contextual editor inspection, insertion, creation, editing, and draft preview.
- **Hot Plate**: compact active-chat decision controls from the composer action row.

The removed top-level Resolution page was an implementation-oriented debugging workflow. Preview now lives with the macro being authored, which is the actual user task.

Fixed mount adapters are intentionally thin. A toolbar mount creates only a launcher; the actual surface lives in a host modal or drawer. This keeps editor chrome clean and prevents MacroLab from treating every canonical mount point as an invitation to occupy space.

## Commit contract

A macro invocation has two relevant facts:

1. `ctx.chatId` identifies the authoritative chat.
2. `ctx.commit` tells MacroLab whether a missing/changed decision may be persisted.

The internal decision handlers follow this rule:

```text
persisted value exists
  -> return it

missing value + commit true + chat id
  -> sample, persist, return

missing value + commit false (or no chat id)
  -> sample ephemerally, return
```

Reads are allowed during previews; writes are not attempted.

## Current boundary: no message provenance yet

MacroLab currently knows active-chat decision state, not which specific assistant message consumed which decision revision. Rerolls therefore affect subsequent resolutions and do not rewrite/regenerate an existing assistant response. Message-level provenance plus regenerate-after-reroll remains a separate future engine weld rather than being faked in the UX.

## Clean extension identity

The forge uses the `macrolab` Spindle identifier rather than carrying the prototype `lumi_macro_lab` identity forward. This deliberately creates a clean storage/runtime boundary for the rewrite. Automatic cross-identifier registry migration is not attempted; disable the old prototype before testing the forge so duplicate registered macro names cannot collide.
