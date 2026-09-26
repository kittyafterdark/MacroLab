# Surface map

The first forge deliberately uses only a small subset of the available Spindle mount surface.

## Active

| Surface | Mount | Purpose |
| --- | --- | --- |
| MacroLab | drawer tab | full authoring, Resolution preview, raw state + native variables |
| Hot Plate | `chat_actions` | compact runtime launcher on the same composer action row as native/custom actions; badge reflects committed active-chat decisions |
| Pipette | `world_book_entry_editor` | inspect/create/edit/insert macros at the top of the expanded World Book entry editor |
| Pipette | `loom_block_editor_actions` | dedicated compact block-editor launcher beside Back; the general `loom_builder_toolbar` remains untouched for row-sized extension UI |

Closed launchers share a small stroke-only Pipette mark so host tinting stays legible. The larger custom Pipette/Hot Plate artwork is reserved for opened surfaces.

## Deliberately deferred

The forge does **not** occupy message footers, every character card, landing chrome, both sidebars, or every editor mount simply because those points exist.

Likely future uses, once backed by actual behavior:

- `message_context_menu` / `message_actions`: state used by this message, then reroll + regenerate.
- `world_book_entry_row`: subtle conditional macro-presence marker.
- `character_browser_card_actions`: contextual macro marker/action.
- lorebook half/enhanced workspace host surfaces: rich side-by-side Pipette.
- `command_palette_actions`: Open Hot Plate, inspect current surface, reroll unlocked.
- `quick_toolbar.workspace`: possible desktop-native expanded Hot Plate.

## Pipette targeting

Canonical mounts provide a location to render extension UI but do not, in the forge contract, hand MacroLab the semantic text field being edited. Pipette therefore resolves inside the launcher surface first: the active World Book entry or Loom block editor. It keeps the last focused editable only when that field belongs to the same surface, and prefers a lone visible textarea when the surface contains several controls.

Prompt Variables is deliberately excluded because its modal exposes variable controls rather than a macro-editable text surface.

If the local target is still ambiguous, Pipette fails closed and asks the user to focus the intended field rather than mutating an unrelated editor.

## Contextual authoring

Pipette is no longer a read-only jump point into the drawer. Missing MacroLab references can be defined in place, registered definitions can be edited in place, and a new macro can be created and inserted without leaving the active editor. The full MacroLab drawer remains the global workshop rather than a prerequisite.

## Native-variable ownership

MacroLab records a small user-scoped ownership index only when a variable is explicitly created through its `+ Add` flow. Existing preset/extension variables remain discoverable but collapsed by default. Editing a discovered variable does not claim it; deletion requires confirmation.
