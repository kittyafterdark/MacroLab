# Patch manifest

MacroLab UI/mount cleanup against the supplied Lumiverse staging snapshot.

- `src/frontend.ts`: Hot Plate moved to `chat_actions`; duplicate Loom Pipette mount removed; World Book Pipette moved to `world_book_entry_editor`; launcher targeting made surface-local; Hot Plate gained `+ New macro`; compact launchers normalized.
- `src/icons.ts`: added a stroke-only Pipette launcher icon; large custom artwork remains modal-only.
- `tests/frontend-surface-contract.mjs` + `tests/fixtures/spindle-surfaces.json`: minimal host-mount contract guarding against mount drift, duplicate Loom launchers, and regressions to the old placements.
- `README.md`, `docs/SURFACES.md`: updated surface behavior.
- `package.json`: test script now runs backend harness plus the surface contract.

No Lumiverse source files were modified.
