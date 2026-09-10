# Surface map

The first forge deliberately uses only a small subset of the available Spindle mount surface.

## Active

| Surface | Mount | Purpose |
| --- | --- | --- |
| MacroLab | drawer tab | full authoring, Resolution preview, raw state + native variables |
| Hot Plate | `chat_input_tools_right` | compact runtime launcher; badge reflects committed active-chat decisions |
| Pipette | `world_book_entry_toolbar` | inspect/insert macros in the focused World Book entry field |
| Pipette | `preset_editor_toolbar` | inspect/insert macros in the focused preset field |
| Pipette | `loom_builder_toolbar` | inspect/insert macros in the focused Loom builder field |
| Pipette | `prompt_variables_toolbar` | inspect/insert macros in the focused prompt-variable field |

The closed launchers all use the canonical beaker mark. The opened surfaces reveal their semantic variant: Pipette or Hot Plate.

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

Canonical toolbar mounts provide a location to render extension UI but do not, in the forge contract, hand MacroLab the semantic text field being edited. Pipette therefore keeps the last focused `textarea`, textual `input`, or `contenteditable` element.

If that target is gone and exactly one visible editable field exists, it can be inferred. If several are visible, Pipette fails closed and asks the user to focus one rather than mutating an ambiguous editor.
