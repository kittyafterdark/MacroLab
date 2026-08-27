# Changelog

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
