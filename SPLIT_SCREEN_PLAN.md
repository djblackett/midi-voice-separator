# Detailed Plan: Split-Screen Comparison (Master-Plan Feature 3)

Repository: `chiptune-voice-separator`
Date: 2026-07-11
Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (contracts M9, M10, M11, M13), `EDITABLE_SIDE_B_PLAN.md`
(Feature 2, complete).
Status: architecture drafted; implementation not started.
Verified entry boundary: Feature 2 (Editable Side B) is complete — one `EditorDocument`/command/
history/materializer, a two-branch hook (`useComparisonEditor` over `comparisonBranches`) with an
`activeSide`, a reference-only `ComparisonWorkspace`, honest provenance, revision-guarded async.
This plan begins from commit `48af621`.

---

## 1. Purpose and scope

Feature 2 made side B a live editable branch shown one-at-a-time through the A/B/Diff toggle.
Feature 3 shows A and B **simultaneously**, side by side, with musical time aligned — and in doing
so lands the correspondence and presentation contracts that were deliberately deferred from
Feature 2.

**In scope**

- **M9** — deterministic maximum-weight bipartite voice correspondence, replacing the greedy
  `matchVoices`. Reports matched pairs, unmatched voices, overlap weights, ambiguity/ties, and
  split/merge evidence.
- **M10** — presentation keys so a matched B voice keeps its A partner's color (and defines the
  timbre key that Feature 5 will consume) across the toggle and across both panes.
- **M13** — controllable, side-qualified pane state: a controlled time viewport that can be linked
  across panes, an explicit linked-vs-independent pitch-scroll choice, side-qualified accessible
  canvas names, and a visible active-side focus indicator.
- **M11 (full)** — one workspace projection resolving visible sides, active/monitored side, per-side
  materialization, permissions, side-local selection/solo, presentation maps, and source revisions.
  Replaces the ad-hoc single-side derivations Feature 2 left in `App.tsx`.
- Split UI: a "Split" layout rendering both branches, linked time viewport by default, and linked
  selection through **shared note IDs** (A and B share one note universe — B is forked from A's
  lineage).

**Explicit non-goals** (each is a later master-plan feature)

- **A/B playback of two sides (M12)** — Feature 5. In split, one transport still plays the active/
  monitored side; the shared playhead is *drawn* in both panes (time is linked), but no dual audio
  and no per-pane engine. Presentation **timbre** keys are derived here but consumed by playback in
  Feature 5.
- **Content-based note matching (M16)** — Feature 7. Linked selection here uses note-ID equality,
  valid only because A and B share a note universe. Cross-document note correspondence stays out.
- **Cross-import comparison (M17)** — Feature 8. Both panes are always same-lineage branches.
- **Voice-lane editing parity (M15)** — Feature 6. Split panes render the piano view; lane view in
  a pane is out of scope.

---

## 2. Current baseline (verified by reading)

- **Voice matching is greedy.** `matchVoices(before, after)` (`assignmentDiff.ts:128`) builds an
  overlap map then "repeatedly commit[s] the single best remaining pair" (its own comment,
  line 160). It can pick a globally inferior pairing. Output `VoiceMatching = { matched:
  {beforeVoiceId, afterVoiceId}[], removedVoiceIds, addedVoiceIds }`. Percussion is force-matched.
  It is consumed today only by the diff summary.
- **Colors come from the raw voice id.** `getVoiceFillColor(voiceId)` → `voiceColorIndex(voiceId)` =
  `(voiceNumber - 1) % VOICE_COLORS.length`, parsing the `voice-N` suffix (`drawPianoRoll.ts:61`).
  A matched voice with a different id on B therefore renders a different color — the M10 problem.
- **The PianoRoll owns its viewport.** `viewportWindow` and `pitchViewportWindow` are `useState`
  inside `PianoRoll.tsx` (lines 160-161), mutated by its own wheel handler and reset on a genuinely
  new project. Two `PianoRoll` instances would scroll independently — linking requires lifting this
  to a controlled prop.
- **Rendering follows the active side.** `displayedProject = materialize(active document)`; a single
  `<PianoRoll project={pianoRollProject} …>` sits in `.editor-grid`. `App.tsx` computes selection,
  solo, diagnostics, playback, and diff off the active side directly.
- **The workspace is minimal.** `ComparisonWorkspace = { targetSnapshotId, viewing: "A"|"B"|"diff" }`;
  `activeSide` lives in the branch hook. There is no `layout`, no per-pane state, no projection
  object.
- **Feature 2 already reconciles nothing through correspondence.** After a rerun,
  `reconcileVoiceOrderAfterReassign` folds new voice ids into order by raw id; labels/solo/active
  voice are not remapped through a matching (the M9 reconciliation gap).

---

## 3. Target architecture (types and boundaries)

### 3.1 Voice correspondence service (M9)

```ts
// src/domain/midi/voiceCorrespondence.ts
export interface VoicePair {
  readonly aVoiceId: string;
  readonly bVoiceId: string;
  readonly overlap: number;         // shared-note weight
}
export interface VoiceCorrespondence {
  readonly matched: readonly VoicePair[];
  readonly unmatchedA: readonly string[];
  readonly unmatchedB: readonly string[];
  readonly ambiguous: readonly { readonly voiceId: string; readonly side: "A" | "B" }[]; // tie evidence
  readonly splits: readonly { readonly aVoiceId: string; readonly bVoiceIds: readonly string[] }[];
  readonly merges: readonly { readonly bVoiceId: string; readonly aVoiceIds: readonly string[] }[];
  readonly matcherVersion: number;
}

export function correspondVoices(a: DiffSide, b: DiffSide): VoiceCorrespondence;
```

Deterministic **maximum-weight bipartite matching** over shared-note overlap (Hungarian /
successive-shortest-augmenting-path on a small dense matrix — voice counts are tiny). Ties are
broken by a total order (overlap desc, then voice id asc) and *also reported* as `ambiguous`, never
hidden. Percussion is matched by its semantic role, outside the weight problem. The old
`VoiceMatching` becomes a thin adapter over this (or `matchVoices` is retired and callers move to
`correspondVoices`), so the disjoint-id diff guard is never weakened (rejected-design list).

### 3.2 Presentation keys (M10)

```ts
// src/features/piano-roll/presentationKeys.ts
export type PresentationKey = string;   // canonical color/timbre bucket, NOT a voice id
export interface PresentationKeyMap {
  keyForSide(side: "A" | "B", voiceId: string): PresentationKey;
}
export function derivePresentationKeys(
  correspondence: VoiceCorrespondence,
  aVoiceOrder: readonly string[],
  bVoiceOrder: readonly string[],
): PresentationKeyMap;
```

- A voices receive canonical A keys (their existing color slot).
- Matched B voices reuse their A partner's key.
- Unmatched B voices receive stable B-local keys that don't collide with A's.
- Percussion retains a semantic presentation key.

Rendering and the legend consume presentation keys; domain voice ids are never rewritten (M8/M10).
`getVoiceFillColor`/`getVoiceStrokeColor` gain a presentation-key-based path; the current
voice-id path becomes the identity mapping (single side → same colors as today).

### 3.3 Controlled viewport (M13, part 1)

`PianoRoll` gains optional controlled viewport props while staying backward-compatible:

```ts
interface PianoRollProps {
  // …existing…
  timeViewport?: ViewportWindow;                 // controlled when provided
  onTimeViewportChange?: (next: ViewportWindow) => void;
  pitchViewport?: PitchViewportWindow;           // controlled when provided
  onPitchViewportChange?: (next: PitchViewportWindow) => void;
}
```

When omitted, the component keeps its current internal state (uncontrolled) — behavior-preserving.
When provided, pan/zoom call the callbacks and render from the prop, so a parent can share one time
window across two panes.

### 3.4 Workspace projection (M11, full) and pane state (M13, part 2)

```ts
// src/app/editor/comparisonWorkspace.ts (extended)
export type ComparisonLayout = "single" | "split";
export interface ComparisonWorkspace {
  targetSnapshotId: string;
  viewing: CompareViewing;          // drives the single-layout canvas + diff view
  layout: ComparisonLayout;
  linkTimeViewport: boolean;        // default true
  linkPitchViewport: boolean;       // default false (explicit choice, M13)
}

// src/app/editor/comparisonProjection.ts (new)
export interface SideProjection {
  readonly side: "A" | "B";
  readonly document: EditorDocument;
  readonly project: MidiProject;                 // materialized
  readonly editable: boolean;                    // side === activeSide && layout allows edit
  readonly revisionRef: { branchId: BranchId; revision: number };
}
export interface ComparisonProjection {
  readonly visibleSides: readonly ("A" | "B")[]; // ["A"] | ["A","B"] | (diff -> ["A"])
  readonly activeSide: "A" | "B";
  readonly sideA: SideProjection;
  readonly sideB: SideProjection | null;
  readonly presentation: PresentationKeyMap;
  readonly correspondence: VoiceCorrespondence | null;
}
export function resolveComparisonProjection(/* branches, workspace */): ComparisonProjection;
```

The projection is the single place that decides what renders, what edits, and how voices map to
presentation — closing the "B visible while commands/playback hit A" failure mode (M11). Per-pane UI
state (selection, solo, view mode, tool drafts) is side-qualified and separate from the document.

---

## 4. Migration strategy

Same discipline as Feature 2: introduce pure cores with their own tests, flip callers behind a
behavior-preserving seam, then build the new UI last.

1. Land M9 correspondence and M10 presentation keys as **pure, tested modules** first; wire the
   *diff* and single-side rendering to them without any visible change (identity mapping for one
   side, and correspondence output shaped to keep the current diff numbers).
2. Make the `PianoRoll` viewport controllable **uncontrolled-by-default**, so the single canvas is
   untouched.
3. Introduce the projection resolver and route the existing single-canvas render through it
   (behavior-preserving, `visibleSides === ["A"]` or the active side).
4. Only then add the split `layout`, the second pane, linking, and linked selection.

No slice mixes "introduce core" with "delete old path"; each is one commit, green before commit.

---

## 5. Commit-sized slices

### Phase A — Correspondence + presentation (pure domain, no visible change)

- **A1. Maximum-weight bipartite `correspondVoices` (M9).** New `voiceCorrespondence.ts` + a thorough
  test suite: determinism, tie reporting, and at least one fixture where greedy picks a globally
  inferior pairing but max-weight does not. Percussion role-matched.
- **A2. Retire the greedy matcher behind correspondence.** Re-express `matchVoices`/the diff summary
  on top of `correspondVoices` (adapter), keeping every existing `assignmentDiff`/`diff-summary`
  test green. Behavior-preserving numbers; better pairing only in the previously-ambiguous cases.
- **A3. Presentation keys (M10).** New `presentationKeys.ts` + tests (matched B reuses A's key,
  unmatched B stable and non-colliding, percussion semantic, single-side identity).
- **A4. Presentation-key rendering path.** `getVoiceFillColor`/`getVoiceStrokeColor` and the legend
  accept a presentation key; single-side rendering passes the identity map — pixels unchanged.
  *Manual pause:* confirm single-side colors are visually identical.

### Phase B — Controlled viewport (M13 part 1)

- **B1. Controlled viewport props on `PianoRoll`.** Add `timeViewport`/`onTimeViewportChange` and
  `pitchViewport`/`onPitchViewportChange`; internal state remains the uncontrolled default.
  Behavior-preserving; unit/e2e for existing pan/zoom unchanged.

### Phase C — Workspace projection (M11)

- **C1. Extend `ComparisonWorkspace`** with `layout`/`linkTimeViewport`/`linkPitchViewport`
  (defaults: single / true / false). Behavior-preserving.
- **C2. `resolveComparisonProjection` + route the single canvas through it.** Move App's ad-hoc
  active-side render/edit/selection derivations behind the projection. `visibleSides` is the active
  side; behavior-preserving. This is the integration seam the split UI builds on.

### Phase D — Split UI (M13 part 2)

- **D1. "Split" layout with two panes.** A layout control; when split, render side A and side B
  panes from their `SideProjection`s, each with a side-qualified accessible name ("Side A piano
  roll" / "Side B piano roll"). Only the active side's pane is editable; the other is read-only.
- **D2. Linked time viewport (default) + explicit pitch-scroll choice.** A shared time window drives
  both panes' controlled `timeViewport`; a toggle switches pitch/lane scroll between linked and
  independent (default independent). Musical time stays aligned by default.
- **D3. Visible active-side focus + edit routing.** An explicit active-pane indicator (not inferred
  from DOM focus); clicking a pane makes that side active; all inspectors/commands bind to the
  active branch (already true via the hook — verified, not re-plumbed).
- **D4. Linked selection through shared note IDs.** Selecting notes in one pane highlights the same
  note ids in the other (valid: shared note universe). Presentation keys give matched voices the
  same color across panes. *Manual pause:* split readability and focus clarity on the two dense
  fixtures.

### Phase E — Correspondence-based reconciliation (M9 follow-through)

- **E1. Reconcile labels/order/active-voice/solo after a rerun through correspondence.** Replace the
  raw-id `reconcileVoiceOrderAfterReassign` carry-forward with a correspondence-driven remap, so a
  rerun that reallocates voice ids keeps labels/solo/active-voice stable. Guarded by the existing
  rerun and diff-summary suites plus new correspondence-reconciliation tests. *(Sequenced last
  because it changes existing rerun behavior; can ship independently if split UI is prioritized.)*

---

## 6. Contracts consumed, and where each is satisfied

| Contract | Satisfied by |
|----------|--------------|
| M9 maximum-weight correspondence | A1, A2; reused by A3, D4, E1 |
| M10 presentation keys | A3, A4 (render); timbre consumption deferred to Feature 5 |
| M11 one workspace projection | C1, C2, D1 |
| M13 controlled/side-qualified panes | B1, D1–D4 |
| M8 side-scoped identity | consumed (already landed in Feature 2) |
| M12 dual playback | out of scope (Feature 5) |
| M15 lane parity | out of scope (Feature 6) |
| M16 note content matching | out of scope; linked selection uses shared ids (Feature 7) |

---

## 7. Verification strategy

- **Vitest:** correspondence determinism + globally-optimal-vs-greedy + tie/split/merge reporting
  (A1); diff numbers unchanged over correspondence (A2); presentation-key mapping rules (A3);
  projection target/permission/visibility resolution (C2); rerun reconciliation through
  correspondence (E1).
- **Playwright:** split renders two side-qualified canvases; linked time scroll keeps panes aligned;
  independent pitch scroll when unlinked; clicking a pane sets the active side and routes an edit
  there only; linked selection highlights corresponding notes; a matched voice shows the same color
  in both panes.
- **Manual pause points:** single-side color identity after A4; split readability/focus clarity on
  the two dense fixtures after D4.

### Mandatory regression scenarios (from the master plan) exercised here

- Reallocated voice ids do not read as added/removed voices — A2 (already tested; must stay green).
- Matched voices retain labels, color, solo mapping — A3/A4/E1.
- All edits route to the active side even with both panes visible — C2/D3.
- Switching visual sides never leaves hidden audio running without controls — playback stays on the
  active/monitored side; verified no divergence via the projection (C2/D3).

---

## 8. Rollback / failure behavior

- Correspondence is pure and total; on degenerate input (no overlap) it returns all-unmatched and
  the UI shows independent B-local colors — never a crash or a false pairing.
- The controlled viewport is opt-in; if a pane fails to provide a window, it falls back to
  uncontrolled internal state.
- Split is a presentation layout over branch references (M4); leaving split or discarding B drops
  only pane state, never document state.

---

## 9. Decisions needed before implementation

1. **Matcher retirement vs adapter (A2).** Recommend replacing `matchVoices` internals with
   `correspondVoices` and keeping a thin `VoiceMatching` adapter for the diff, rather than two
   matchers. Confirm.
2. **Reconciliation timing (Phase E).** Recommend sequencing E1 last and allowing it to ship
   separately, since it changes existing rerun behavior and is not required to render a correct
   split. Confirm it belongs in Feature 3 rather than a follow-up.
3. **Split entry point.** Recommend a "Split" toggle alongside the A/B/Diff control (single ↔ split),
   with the active side chosen by clicking a pane. Confirm the control placement.

---

## 10. Verified boundary this plan hands forward

On completion: deterministic voice correspondence and presentation keys reused across diff, split,
and (later) playback; a controllable, side-qualified pane/viewport model; and one workspace
projection that render, edit, and selection all read from. Feature 4 (keyboard side switching) then
adds the command registry (M14) over this active-side model; Feature 5 (A/B playback) consumes the
presentation timbre keys and the projection's monitored side to build the dual-source transport
(M12).
