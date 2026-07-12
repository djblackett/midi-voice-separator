# Detailed Plan: Keyboard Command Registry + Side Switching (Master-Plan Feature 4)

Repository: `chiptune-voice-separator`
Date: 2026-07-12
Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (contract M14), `SPLIT_SCREEN_PLAN.md` (Feature 3,
complete).
Status: architecture drafted; implementation not started.
Verified entry boundary: Features 1–3 are complete. There is one editor document/command/history/
materializer, a two-branch hook with an `activeSide`, a workspace projection, and a working split
view. This plan begins from commit `2e6dc1d`.

---

## 1. Purpose and scope

Feature 3 lets the user click a pane (or an A/B button) to choose the active side. Feature 4 adds
**keyboard** side switching, and to do it safely it first lands the **command registry (M14)**:
one place that resolves a key event into an authorized command, so no shortcut can fire an editor
tool by accident, mutate a read-only side, or run while typing in a field.

**In scope**

- **M14 command registry** — commands defined separately from key bindings; a pure resolver that
  applies, in order: input/contenteditable focus, binding match, and authorization (active-side
  read/write permission, busy-operation gate, mutating-vs-non-mutating, key-repeat policy).
- **Migrate the existing App keydown handler** onto the registry, behavior-preserving.
- **Side-switching shortcuts** — activate side A / side B (and/or toggle) from the keyboard, with
  **non-conflicting bindings** (bare `B` is already Brush).
- **Systematic authorization** — every mutating shortcut, including undo/redo, is authorized by the
  registry before running, closing the read-only-compare undo path at the resolver rather than
  relying on each handler's internal guard.

**Explicit non-goals**

- **User-remappable keybindings / a shortcut-editor UI** — the registry makes this possible later,
  but Feature 4 ships a fixed binding table.
- **New editing shortcuts** beyond side switching (no new paint/selection/marker keys).
- **A/B playback keys** — Feature 5.
- **Reworking PianoRoll's two component-local `Escape` handlers** (cancel paint stroke, close
  context menu) into the registry — they are canvas-local and stay; see §2.

---

## 2. Current baseline (verified by reading)

- **One App-level handler.** `App.tsx` registers a single `window` `keydown` listener in a
  `useEffect` (`App.tsx:515-636`) with a large dependency array. It is an ordered imperative chain:
  1. **Focus guard** — returns early if the target is `<input>`/`<textarea>`/`<select>`/
     `contentEditable` (`518-525`). This already keeps typing in fields safe.
  2. **Undo / redo** — `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (`527-535`), _before_ the read-only gate;
     `handleUndo`/`handleRedo` each internally no-op when `isCompareReadOnly` (added in Feature 2).
  3. **Escape** — paint→select, else clear selection (`537-543`).
  4. **Read-only gate** — `if (isCompareReadOnly) return;` (`546-548`) blocks everything below.
  5. **Tab / Shift+Tab** — step flagged notes (`550-562`).
  6. **P / B / L / W** — paint tools; **`B` is Brush** (`564-583`).
  7. **`[` / `]`** — brush size (`585-593`).
  8. **`H`** — confidence heatmap (`595-605`).
  9. **`1`–`9`** — assign selection to a voice, or set the active paint voice (`607-632`).
- **Component-local Escape in PianoRoll.** Two small `window` `keydown` listeners inside
  `PianoRoll.tsx` handle `Escape` only: cancel an in-progress paint stroke (`564-570`) and close the
  context menu (`1086-1092`). In split there are two PianoRoll instances, so these register twice —
  harmless (idempotent), but a reason the App registry, not PianoRoll, owns global shortcuts.
- **Permissions are ad-hoc.** Read-only is a single early `return`; busy state (`isReassigning`)
  does not gate shortcuts at all; undo/redo authorization lives inside the handlers, not the
  dispatch path.
- **`activeSide` is already the edit target.** Editing shortcuts dispatch through
  `dispatchEditorCommand`, which targets the active branch — so a side-switch command only needs to
  move `activeSide`; the existing shortcuts then operate on the newly active side for free.

---

## 3. Target architecture (types and boundaries)

### 3.1 Commands, bindings, and context (M14)

```ts
// src/app/keyboard/keyboardCommands.ts
export type KeyboardCommandId =
  | "undo"
  | "redo"
  | "clearSelectionOrExitPaint"
  | "stepFlaggedForward"
  | "stepFlaggedBackward"
  | "toolPencil"
  | "toolBrush"
  | "toolLasso"
  | "toolWand"
  | "brushSmaller"
  | "brushLarger"
  | "toggleConfidenceHeat"
  | "assignVoice1" /* …2–9 */
  | "activateSideA"
  | "activateSideB";

export interface KeyboardCommand {
  readonly id: KeyboardCommandId;
  /** Mutating commands require write permission on the active side. */
  readonly mutating: boolean;
  /** Allowed to auto-repeat when the key is held (default false). */
  readonly repeatable?: boolean;
}

export interface KeyChord {
  readonly key: string; // event.key, compared case-insensitively where noted
  readonly ctrlOrMeta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export interface KeyboardContext {
  readonly focusInEditableField: boolean;
  readonly hasProject: boolean;
  readonly activeSideEditable: boolean; // false in the read-only diff view
  readonly busy: boolean; // an async op (e.g. re-run) is in flight
  readonly comparisonOpen: boolean; // side switching only applies in comparison
}

/** Pure: resolves a key event to an authorized command id, or null. */
export function resolveKeyboardCommand(
  event: KeyboardEventLike,
  context: KeyboardContext,
): KeyboardCommandId | null;
```

The resolver is the single choke point and applies, in order:

1. **Focus** — if `focusInEditableField`, return `null` (typing is never a shortcut).
2. **Binding match** — find the command whose `KeyChord` matches the event (modifiers exact).
3. **Repeat policy** — if `event.repeat` and the command is not `repeatable`, return `null`.
4. **Authorization** — a `mutating` command returns `null` when `!activeSideEditable` or `busy`;
   non-mutating navigation/toggles are allowed. This is where "shortcuts cannot bypass permissions"
   is enforced, uniformly, including undo/redo.

The App handler becomes a thin adapter: build the context, call the resolver, and on a non-null id
`preventDefault()` and dispatch to the matching run-function (kept in App, keyed by id). Commands
(what they do) stay in App; bindings and authorization (whether/when they run) move into the pure
registry.

### 3.2 Side-switching commands

`activateSideA` / `activateSideB` are **non-mutating** (they move focus/active side, never edit).
They resolve only when `comparisonOpen`. Their run-functions route by layout: in single view they
drive the existing view+active switch (`handleSetCompareViewing`), in split they drive
`handleActivateSide`. Bindings are **`Alt+A` / `Alt+B`** (DECIDED, §9) — mnemonic and clear of the
paint-tool letters (`P/B/L/W`), `H`, `[`/`]`, and `1`–`9`.

---

## 4. Migration strategy

1. Build `resolveKeyboardCommand` + the binding table as a **pure, tested module** mirroring the
   current handler's behavior exactly (same keys, same focus guard, same read-only gate expressed
   as `mutating` + `activeSideEditable`).
2. Replace the App handler body with the adapter (resolve → dispatch by id), keeping every
   run-function as-is. Verify no behavior change with the existing selection/paint/heatmap/undo
   e2e suites.
3. Only then add the side-switch commands/bindings and the busy gate — the genuinely new behavior.

No slice mixes "introduce the resolver" with "change a shortcut's behavior."

---

## 5. Commit-sized slices

### Phase A — Command registry (behavior-preserving)

- **A1. Pure `resolveKeyboardCommand` + binding table + tests.** Encode today's bindings and the
  focus/read-only/repeat/mutating rules. Unit tests: focus blocks all; `Ctrl+Z` → `undo`;
  read-only blocks `assignVoice*`/tools but not `undo`/`redo`/`clearSelection`; `event.repeat`
  blocks non-repeatable toggles. Unwired.
- **A2. Adapt the App handler to the resolver.** App builds `KeyboardContext` and dispatches by id;
  run-functions unchanged. Behavior-preserving; existing e2e (selection-and-reassignment,
  paint-mode, smart-fixes, conflicts-and-ruler) stay green.

### Phase B — Side switching (the feature)

- **B1. Add `activateSideA`/`activateSideB` commands + bindings + run-routing.** Non-mutating,
  `comparisonOpen`-gated, routed to view/active switch by layout. Playwright: in split, the chosen
  keys move the active side (focus ring + A/B `aria-pressed`) without entering paint mode or
  assigning a voice; the keys do nothing outside a comparison.

### Phase C — Systematic authorization (M14 completeness)

- **C1. Enforce authorization at the resolver and add the busy gate.** Undo/redo now resolve to
  `null` when the active side is read-only (the registry, not the handler, blocks them), and all
  mutating shortcuts resolve to `null` while `busy` (an async re-run is in flight). Remove the
  now-redundant internal read-only guards from `handleUndo`/`handleRedo`. Tests: a mutating
  shortcut during a slow faked re-run is dropped; undo in the diff view is blocked at the resolver.

---

## 6. Contracts consumed, and where each is satisfied

| Contract                                            | Satisfied by                           |
| --------------------------------------------------- | -------------------------------------- |
| M14 registry (bindings ≠ commands)                  | A1, A2                                 |
| M14 focus / input safety                            | A1 (focus guard in resolver)           |
| M14 authorization before mutation (incl. undo/redo) | A1, C1                                 |
| M14 key-repeat + busy gating                        | A1 (repeat), C1 (busy)                 |
| M14 non-conflicting side-switch bindings            | B1 (§9 decision)                       |
| Active-side edit routing                            | consumed (already landed in Feature 3) |

---

## 7. Verification strategy

- **Vitest:** resolver truth table — focus blocks everything; each existing chord maps to its
  command; mutating commands blocked when read-only or busy; non-mutating allowed; `event.repeat`
  respects `repeatable`; side-switch resolves only when `comparisonOpen`.
- **Playwright:** existing shortcut suites stay green after A2 (no behavior change); keyboard side
  switching moves the active side in split without firing a tool or assigning a voice; a mutating
  shortcut during a slow re-run is dropped; undo in the diff view does nothing.
- **Manual pause point:** the side-switch chord feels natural and does not collide with muscle
  memory for the paint tools.

### Mandatory regression scenarios (from the master plan) exercised here

- Switching cannot fire an editor tool — B1 (side-switch keys chosen to avoid tool letters).
- Input fields remain safe — A1 (focus guard) with an e2e typing in the snapshot-name field.
- Shortcuts cannot bypass permissions — C1 (read-only + busy gates at the resolver).
- B-side shortcuts cannot collide with Brush — §9 binding choice, asserted in B1.

---

## 8. Rollback / failure behavior

- The resolver is pure and total; an unmatched event returns `null` and the event is left alone
  (no `preventDefault`), so unknown keys behave exactly as the browser default — no regression risk
  for keys the app does not own.
- If a side-switch binding turns out to conflict in practice, only the binding table changes;
  commands and authorization are untouched.

---

## 9. Decisions needed before implementation

1. **Side-switch bindings. RESOLVED 2026-07-12 — `Alt+A` / `Alt+B`** (activate side A / B):
   mnemonic and clear of every current chord (bare `B` is Brush). Alternatives considered and
   rejected: a single toggle key (less explicit), `Alt+Arrow` (no mnemonic).
2. **Scope of the busy gate (C1).** Recommend blocking _mutating_ shortcuts while `isReassigning`,
   leaving navigation/undo-redo/side-switch available. Confirm.
3. **Undo/redo internal guards.** Recommend removing the internal `isCompareReadOnly` guards from
   `handleUndo`/`handleRedo` once C1 authorizes at the resolver, so authorization lives in exactly
   one place. Confirm (the alternative is defense-in-depth: keep both).

---

## 10. Verified boundary this plan hands forward

On completion: one pure, tested keyboard resolver that all global shortcuts flow through, with
focus safety and permission/ busy authorization enforced uniformly, plus keyboard side switching.
Feature 5 (A/B playback) then adds transport/monitor-side shortcuts as new commands in the same
registry, and any future user-remappable-keys work only needs to make the binding table editable.
