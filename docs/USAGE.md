# MacroLab usage tutorial

MacroLab has one core loop:

> **Build a macro → test it → insert it into a prompt → generate → control the committed choices in Chat State / Hot Plate.**

## Five-minute tutorial

### 1. Create a macro

Open **MacroLab → Library** and choose **+ New macro**.

Name it `origin` and use:

```text
Born {{pick::normally::from a ritual::from the sea}}.
```

The **Recipe** section should show one sticky `pick` decision.

### 2. Test the draft in place

Choose **Test preview**. The preview uses the real MacroLab instrumentation and resolver, but runs with `commit:false`.

That means:

- existing committed choices can be reused;
- missing choices can be sampled for the preview;
- newly sampled preview values are not written to chat state.

Use **Roll preview again** as much as you want while authoring. Preview output is disposable.

### 3. Save and insert it

Save the macro. In a supported Loom block or World Book entry, open **Pipette** and insert `{{origin}}`.

You can also create or edit a macro directly from Pipette without leaving the editor. The contextual form has the same non-committing preview flow.

### 4. Generate normally

A real host generation resolves the macro with committing semantics. Missing MacroLab decisions become chat-scoped sticky state.

If `origin` chose `from a ritual`, later uses of the same `origin · default` instance will continue returning that value until you reroll or reset it.

### 5. Open Chat State or Hot Plate

**Chat State** in the drawer and **Hot Plate** from the composer action row show the same committed decision engine at different densities.

For each decision you can:

- **Reroll** it for future generations;
- **Undo** the latest reroll;
- **Lock / Unlock** it;
- **Reset** it so the next committing resolve rolls again.

Instance-level controls can reroll or reset all unlocked decisions in a macro instance.

> Rerolling does not rewrite an assistant message that already exists. It changes what future macro resolution will use.

## Instances

Use an argument when the same macro needs independent state:

```text
{{origin::alice}}
{{origin::bob}}
```

Without arguments, the instance is `default`.

## Nested choices

The Library **Recipe** view shows the stochastic decision graph, including nested `pick` / `random` nodes. Chat State shows committed runtime decisions rather than pretending every possible branch became canon.

## Pipette

Pipette only appears on supported macro-editable text surfaces. It:

- inspects the field that launched it;
- lists registered, native, stochastic, and external macro references;
- inserts registered macros;
- creates missing definitions;
- edits definitions without leaving the current editor.

If a target is ambiguous, Pipette fails closed instead of guessing an unrelated textarea.

## Advanced variables

**Chat State → Advanced variables** exposes native Lumi local/chat/global variables for power-user debugging. MacroLab's own decision variables stay hidden from that list and are managed through Chat State / Hot Plate.
