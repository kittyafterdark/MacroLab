# Surface map

MacroLab deliberately uses a small subset of Spindle mounts and keeps the product workflow centered on authoring + committed chat state.

## Active

| Surface | Mount | Purpose |
| --- | --- | --- |
| MacroLab | drawer tab | **Library** authoring/Recipe/preview + **Chat State** committed decisions; native variables are Advanced-only |
| Hot Plate | `chat_actions` | compact runtime launcher on the composer action row; badge reflects committed active-chat decisions |
| Pipette | `world_book_entry_editor` | inspect/create/edit/test/insert macros at the top of the expanded World Book entry editor |
| Pipette | `loom_block_editor_actions` | dedicated compact block-editor launcher beside Back; the general `loom_builder_toolbar` remains untouched for row-sized extension UI |

Closed launchers share a small stroke-only Pipette mark so host tinting stays legible. The larger custom Pipette/Hot Plate artwork is reserved for opened surfaces.

The MacroLab drawer registers a native Spindle guide containing the five-minute tutorial and reference concepts.

## Authoring workflow

The old top-level `Resolution` page is removed. Preview belongs to the macro draft:

1. edit a body;
2. inspect the detected Recipe;
3. test the current unsaved body with `commit:false`;
4. save when satisfied;
5. insert from Library or Pipette.

Pipette's contextual creation/editing form follows the same rule and can preview a draft before saving.

## Chat State and Hot Plate

Chat State and Hot Plate expose committed MacroLab decisions grouped by macro + instance. They support reroll, undo, lock/unlock, reset, and instance-level unlocked reroll/reset.

Native variables are not the primary product workflow anymore. They remain available under **Advanced variables** in Chat State for debugging and power-user work.

Rerolls affect future resolutions. Existing assistant messages are not rewritten because message-level MacroLab provenance is not implemented yet.

## Deliberately deferred

The forge does **not** occupy message footers, every character card, landing chrome, both sidebars, or every editor mount simply because those points exist.

Likely future uses, once backed by actual behavior:

- `message_context_menu` / `message_actions`: show state proven to have been used by that message, then reroll + regenerate.
- `world_book_entry_row`: subtle conditional macro-presence marker.
- `character_browser_card_actions`: contextual macro marker/action.
- lorebook half/enhanced workspace host surfaces: richer side-by-side Pipette.
- `command_palette_actions`: Open Hot Plate, inspect current surface, reroll unlocked.

## Pipette targeting

Canonical mounts provide a location to render extension UI but do not, in the forge contract, hand MacroLab the semantic text field being edited. Pipette therefore resolves inside the launcher surface first: the active World Book entry or Loom block editor. It keeps the last focused editable only when that field belongs to the same surface, and prefers a lone visible textarea when the surface contains several controls.

Prompt Variables is deliberately excluded because its modal exposes variable controls rather than a macro-editable text surface.

If the local target is still ambiguous, Pipette fails closed and asks the user to focus the intended field rather than mutating an unrelated editor.

## Native-variable ownership

MacroLab records a small user-scoped ownership index only when a variable is explicitly created through its Advanced `+ Add` flow. Existing preset/extension variables remain discoverable but collapsed by default. Editing a discovered variable does not claim it; deletion requires confirmation.
