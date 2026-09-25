# Patch manifest

MacroLab UI/mount cleanup against the supplied Lumiverse staging snapshot.

- `src/frontend.ts`: Hot Plate uses `chat_actions`; World Book Pipette uses `world_book_entry_editor`; Loom Pipette uses the dedicated `loom_block_editor_actions` socket; launcher targeting is surface-local; Hot Plate exposes `+ New macro`; compact launchers are normalized.
- `src/icons.ts`: added a stroke-only Pipette launcher icon; large custom artwork remains modal-only.
- `tests/frontend-surface-contract.mjs` + `tests/fixtures/spindle-surfaces.json`: minimal host-mount contract guarding against mount drift, duplicate Loom launchers, and regressions to the old placements.
- `README.md`, `docs/SURFACES.md`: updated surface behavior.
- `package.json`: test script now runs backend harness plus the surface contract.

A companion Lumiverse staging overlay adds the canonical `loom_block_editor_actions` socket beside Back in the native BlockEditor header. It does not move, rename, or repurpose `loom_builder_toolbar`; existing row-sized Loom extensions keep their original host contract.
