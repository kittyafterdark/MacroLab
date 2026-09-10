# MacroLab 2 architecture

MacroLab is split conceptually into three layers even though the forge build keeps the runtime compact.

## 1. Resolution and decision graph

`src/core/decision-graph.ts` is host-agnostic. It finds stochastic nodes, derives human labels, computes context-derived decision identities, scans arbitrary macro references for Pipette, and instruments registered macro bodies with MacroLab's internal sticky handlers.

The graph does not persist anything and does not know about chat ids.

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

## 3. Surfaces

`src/frontend.ts` presents the same engine in three densities:

- **MacroLab**: global authoring/debugging.
- **Pipette**: contextual editor inspection and insertion.
- **Hot Plate**: active chat state manipulation.

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

## Clean extension identity

The forge uses the `macrolab` Spindle identifier rather than carrying the prototype `lumi_macro_lab` identity forward. This deliberately creates a clean storage/runtime boundary for the rewrite. Automatic cross-identifier registry migration is not attempted; disable the old prototype before testing the forge so duplicate registered macro names cannot collide.
