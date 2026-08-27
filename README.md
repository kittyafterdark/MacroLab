# Lumi Macro Lab

A Lumiverse Spindle extension for inspecting macro resolution and turning ordinary Lumi macro bodies into reusable, rerollable named macros.

## What changed in 1.1

Macro Lab now has two workspaces:

- **Resolution** — the original `commit:false` macro preview, now also showing global variables.
- **Macros & State** — register macro names, inspect sticky stochastic decisions, reroll/lock/reset them, and edit native Lumi variables.

The important bit is that Macro Lab does **not** replace Lumi's macro engine and does not change global `{{pick}}` / `{{random}}` semantics. It only captures stochastic nodes while resolving a macro that you registered in Macro Lab.

## Registered macros

Register a macro named `backstory` with a body such as:

```text
{{pick::
  Born in {{pick::a ruined coastal city::a mountain village::the imperial capital}}::
  Raised by {{pick::smugglers::scholars::a disgraced knight}}
}}

At {{random::12::19}}, {{char}} discovered {{pick::a family secret::an ancient relic::a forbidden manuscript}}.
```

Then use it anywhere Lumi resolves macros:

```text
{{backstory}}
```

Arguments create independent **instance keys**:

```text
{{backstory::alice}}
{{backstory::bob}}
```

`alice` and `bob` keep separate sticky decisions in the active chat.

## Rerollable decisions

Inside a registered macro body, ordinary Lumi stochastic macros are instrumented automatically:

- `{{pick::...}}`
- `{{random::...}}`

On the first committing resolve, Macro Lab stores the selected decision in a reserved native **chat variable**. Later resolves reuse it.

From **Macros & State** you can:

- reroll one decision with the visible **↻** button;
- right-click a decision on desktop;
- long-press a decision on touch devices;
- lock/unlock a decision;
- reset a decision so it rolls again on the next committed resolve;
- reroll/reset an entire macro instance while leaving locked decisions alone.

The state value lives in native Lumi chat-variable storage so it follows the chat across generations, regens, swipes, and edits. Macro definitions themselves live in per-user `spindle.userStorage`, so operator/global installs keep each user's registered macro bodies isolated. A shared extension-level index stores only registered macro names so those handlers can be restored after a server restart.

## Native variables

The **Macros & State** tab also exposes Lumi's real variable namespaces:

- local: `name`
- chat: `@name`
- global: `$name`

They can be added, edited, or deleted directly. Macro Lab's reserved decision variables are hidden from this ordinary variable list and shown as structured decisions instead.

## Dry-run behavior

The Resolution tab always calls Lumiverse with `commit:false`.

That means:

- existing sticky decisions are reused so the preview matches the chat's current state;
- previously unseen choices may be sampled for display;
- preview-only samples are **not persisted**;
- mutating macros in the pasted template cannot commit side effects.

## Architecture

Macro Lab registers user definitions through Spindle's native `registerMacro()` API. The registered handler returns an instrumented body, and Lumiverse recursively resolves that returned body through its normal evaluator.

Only stochastic nodes are replaced inside registered bodies:

```text
{{pick::a::b}}
```

becomes an internal Macro Lab decision node for that registered macro + instance + node id. Everything around it — variables, conditionals, nested registered macros, character macros, control flow, and ordinary Lumi syntax — stays in Lumiverse's resolver.

State is keyed by:

```text
macro name + instance + stochastic node id
```

So nested registered macros naturally get their own state namespace.

## Current v1.1.x behavior / sharp edges

This is intentionally a small first implementation of a rather demented idea:

- stochastic node ids are assigned by source order (`d0`, `d1`, ...). Inserting/removing a `pick` or `random` before an existing node changes later ids; use **Reset all** for that instance after structurally editing a macro body.
- instance arguments are identity, not template parameters yet. `{{backstory::alice}}` means “the alice instance”; the body does not automatically receive an `alice` parameter.
- `random` sampling delegates back to Lumi's native `{{random}}` resolver whenever possible; there is a small numeric fallback only if native sampling fails.
- Macro Lab relies on Lumiverse's own recursion/work-budget protection for recursive registered macros.

## Install

Install the repository URL from Lumiverse's Extensions panel, or upload an archive containing `spindle.json` at its root.

The compiled files in `dist/` are included, so users do not need TypeScript installed. The same archive supports both user-scoped and operator/global installs; operator-sensitive calls are explicitly scoped to the requesting `userId`.

## Development

```bash
npm install
npm run check
npm run build
```
