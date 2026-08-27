# Changelog

## 1.1.1

- Fixed startup/state inspection for operator-scoped installs by threading the requesting `userId` through user-sensitive global-variable calls.
- Moved registered macro definitions to per-user `spindle.userStorage` so globally installed Macro Lab instances do not share users' macro bodies.
- Added a shared name-only macro index so registered handlers survive backend restarts without leaking per-user definitions.
- Added one-time migration for the short-lived 1.1.0 shared macro registry.
- Kept host macro registrations alive after one user deletes/renames a definition so another operator user can continue using the same macro name.
- Expanded the runtime harness to enforce operator `userId` requirements and verify two-user macro/global-variable isolation.

## 1.1.0

- Added **Resolution / Macros & State** tabs.
- Added persistent user macro registration via Spindle `registerMacro()`.
- Added independent macro instances via `{{name::instance}}`.
- Added sticky capture for nested `{{pick}}` and `{{random}}` nodes inside registered macro bodies.
- Added per-decision reroll, lock/unlock, and reset.
- Added bulk instance reroll/reset with lock protection.
- Added desktop right-click and mobile long-press decision menus.
- Added native local/chat/global variable inspection and editing.
- Kept Resolution preview non-committing with `commit:false`.
- Hidden Macro Lab's reserved chat-variable state from the normal variable inspector.
