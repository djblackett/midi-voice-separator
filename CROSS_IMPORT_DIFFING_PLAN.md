# Detailed Plan: Cross-Import Diffing (Master-Plan Feature 8)

- Repository: `chiptune-voice-separator`
- Date: 2026-07-15
- Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (M8, M9, M17),
  `CONTENT_BASED_NOTE_MATCHING_PLAN.md` (Feature 7 handoff), and the existing A/B workspace.
- Status: Phases 0.1--D1 are complete. The user explicitly authorized implementation to continue
  before Feature 6 manual audio/ergonomics acceptance was recorded. D2 remains;
  that manual acceptance and Feature 8 D2 native/manual evidence are still unclaimed.

### Execution record (2026-07-14)

- 0.1 `a8db44e`, 0.2 `57bae2a`, A1 `a63de5e`, A2 `eaf81d4`, and A3 `bc2fd00` completed the
  consumer guard, DTO audit, immutable reference ownership, pair-driven voice evidence, and
  side-qualified cross-import diff contract.
- B1 `0a3b875` and B2 `6f82fef` added the native comparison command and revision-guarded
  controller; C1 `fa2417c` generalized pure comparison projection for a read-only reference pane.
- C2 `225777f` wires the external MIDI chooser, materialized-project request, replacement,
  close/reopen, retry, stale-result, file-name, and A/B-exclusion flow without making the
  reference editable. Its serial browser coverage proves the materialized payload and preserves
  the working editor through replacement, stale, and recoverable-error states.
- C3 (2026-07-15) adds the coverage-first diagnostic summary. It displays policy/version, matcher
  and trusted-pair coverage, side-qualified ambiguity/unmatched-note diagnostics, and
  incomparable reasons. Reassignment and voice counts render only after both coverage gates pass.
- C4 (2026-07-15) renders immutable reference/current/diff projections in single or split panes,
  applies changed-note cues only after side/document validation, and keeps reference pointer,
  keyboard, snapshot, export, and playback paths from mutating the working copy. It does not add
  reference playback.
- D1 (2026-07-15) completes the serial Chromium journeys across comparable regenerated IDs,
  replacement/close/retry/stale states, insufficient/duplicate ambiguity, and read-only
  reference/diff/split-pane routing. Incomparable input proves the Diff action stays disabled.
- Partial D2 native automation (2026-07-15) exercises real Tauri/WebView IPC: an app export
  compares back as a comparable immutable reference, while a pitch-shifted export is
  INSUFFICIENT_COVERAGE. Manual pane/readability/interaction evidence remains unclaimed.

### Implementation authorization (2026-07-15)

The user explicitly requested that implementation proceed despite the outstanding Feature 6 manual
checkpoint. That permits the remaining implementation slices, but does **not** record Feature 6
manual acceptance, Feature 8 D2 evidence, or Feature 9 acceptance.

## 1. Purpose and user outcome

Today the editor can compare the live document with a snapshot or editable side B because those
states share parser-local note IDs. `assignmentDiff.ts` correctly refuses near-disjoint IDs, so it
cannot compare a fresh import—even if the two MIDI files contain the same musical notes.

Feature 8 introduces an explicit **read-only reference document** for that external MIDI file. A
user will be able to choose “Compare external MIDI…”, inspect the current editable document beside
the imported reference, and receive an honest result:

- **Comparable:** reassignment and voice-correspondence information based only on trusted,
  unambiguous note pairs, alongside coverage and omitted/ambiguous-note counts.
- **Incomparable:** a coverage/ambiguity explanation with both documents preserved, but no
  reassignment counts, voice matching, changed-note overlay, or “better” implication.
- **Failed import or stale result:** a recoverable error/retry state. The current editable document,
  snapshots, and any previously loaded reference remain unchanged.

The reference is for inspection only. It cannot receive editor commands, undo/redo, correction
overrides, snapshots, promotion, export, or replacement of the working import.

## 2. Entry gates and non-goals

### Entry gates

1. Complete Feature 7 D1 (`test: protect downstream note-correspondence contract`). It must prove
   that only unambiguous pairs can feed voice-overlap evidence and that `incomparable` cannot be
   converted to local-ID diff counts.
2. Resolve Feature 6’s recorded fullscreen split-lane Playwright regression and record its manual
   audio/ergonomics acceptance before Feature 8 release acceptance. The user authorized
   implementation to continue on 2026-07-15; that does not waive the manual acceptance or D2.
3. Start every slice from a clean `git status --short`; do not bundle Feature 6 repair, Feature 7
   matcher retuning, or Feature 9 export changes into this plan.

### Explicit non-goals

- Replacing `assignmentDiff.ts`, snapshot comparison, or editable A/B comparison. They remain the
  efficient same-lineage path and retain `MIN_SHARED_NOTE_RATIO` unchanged.
- Making an external file editable, creating an editable branch from it, persisting references
  across app restart, or saving it as a normal user snapshot.
- Auto-correcting notes/voices from the reference, merging projects, or offering a “use reference”
  action.
- Matching transpositions, controllers, tracks, tempo maps, program changes, or unsupported MIDI
  events. Feature 8 consumes Feature 7’s note matcher only.
- Treating model cost, confidence, or label differences as a cross-import winner claim. The first
  release describes correspondence and assignment differences, not musical quality.
- Export→reimport verification, byte identity, or an export-validation command. Those belong to
  Feature 9 and use `StrictRoundTripV1`, never `CrossImportV1`.

## 3. Verified starting point

Feature 7 is complete through D1 and Feature 8 has already consumed its bounded handoff:

- `src-tauri/src/midi/content_matching.rs` owns rational PPQ normalization,
  `SameDocumentV1`, `StrictRoundTripV1`, and conservative `CrossImportV1` candidate resolution.
  It returns exact and fuzzy pairs, coverage, ambiguity, unmatched side-qualified references, and
  `incomparable` for insufficient coverage.
- Feature 8 owns the serializable match-result DTO and `compare_external_midi` command. The command
  returns an immutable reference plus derived data and does not mutate the working editor.
- The revision-guarded controller and C1 projection are paired with the C2 lifecycle wiring in
  `App.tsx`. The working editor remains the only rendered/editable project until C4 adds the
  reference pane and its hard read-only authorization.

The existing comparison implementation is intentionally not a suitable external-reference owner:

| Current seam                             | Current invariant                                                                     | Feature 8 consequence                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `EditorDocument` / `useComparisonEditor` | A and B are editable branches with history and an active `BranchId`.                  | A reference must not become `EditorDocument` or `EditorBranch`; it would accidentally inherit mutation and promotion paths.      |
| `ComparisonWorkspace`                    | Names a snapshot-backed editable B and only `A`/`B`/`diff` viewing.                   | Generalize it to a tagged target, not a `targetSnapshotId` interpreted everywhere as B.                                          |
| `comparisonProjection.ts`                | Uses shared note IDs to derive voice correspondence and makes either A or B editable. | Add a distinct immutable reference pane and supply correspondence from trusted Feature 7 pairs, never shared IDs.                |
| `assignmentDiff.ts`                      | Calculates local-ID diff output and rejects disjoint imports.                         | Preserve it unchanged; create a separate cross-import diff adapter with paired references.                                       |
| `voiceCorrespondence.ts`                 | Builds overlap from `noteId -> voiceId` on both sides.                                | Refactor its overlap source so trusted `(reference note, editable note)` pairs can supply evidence without pretending IDs match. |
| `App.tsx`                                | One active editable branch owns commands, selection, inspectors, and export.          | Reference rendering must be read-only; the active editable branch remains the only command target.                               |

## 4. Ownership and state model

### 4.1 Reference ownership

Add a small app-layer model, for example `src/app/referenceDocument.ts`:

```ts
export type ReferenceDocumentId = string;

export interface ReferenceDocument {
  readonly documentId: ReferenceDocumentId;
  readonly sourcePath: string;
  readonly importedAt: number;
  readonly project: MidiProject;
  readonly assignmentProvenance: AssignmentProvenance;
}
```

`ReferenceDocument` is immutable after successful import. It owns the parsed project plus the path
label needed for user orientation; it owns neither corrections nor a history. A new selection
replaces this one reference only after its import/match response has passed the request guard.

The reference has a document ID because `NoteRef` must always stay side-qualified. The frontend
creates a fresh opaque ID for each requested reference import and sends it with the command; Rust
echoes it in every returned reference. It is a session-local address, never a file hash or durable
identity claim.

### 4.2 Workspace separation

Keep the existing branch state untouched and make the comparison target explicit:

```ts
type ComparisonWorkspace =
  | {
      readonly kind: "editableSnapshot";
      readonly targetSnapshotId: string;
      readonly viewing: "A" | "B" | "diff";
      readonly layout: "single" | "split";
    }
  | {
      readonly kind: "externalReference";
      readonly referenceDocumentId: ReferenceDocumentId;
      readonly target: {
        readonly branchId: BranchId;
        readonly documentId: DocumentId;
        readonly revision: number;
      };
      readonly viewing: "current" | "reference" | "diff";
      readonly layout: "single" | "split";
    };
```

The external-reference workspace is opened only when no editable B branch exists. Conversely,
starting A/B comparison is disabled while an external-reference workspace is open. This keeps the
workspace two-pane, prevents a hidden three-way comparison, and avoids changing the proven A/B
history/promotion contract. The UI explains that the user can save or exit A/B before loading an
external reference.

Closing an external-reference workspace clears only workspace presentation and derived match state;
the reference remains available for reopening/recomputing until it is replaced or the primary MIDI
import resets the session. It never becomes a named snapshot.

### 4.3 Derived matching state and stale-result protection

The matcher result is derived data, not editor or reference-document state. Keep it in a narrow
controller/hook (for example `useCrossImportComparison`) keyed by:

```ts
interface CrossImportRequestKey {
  readonly requestId: number;
  readonly branchId: BranchId;
  readonly documentId: DocumentId;
  readonly revision: number;
  readonly referenceDocumentId: ReferenceDocumentId;
}
```

Reuse the established B3 guard pattern: branch ID, document revision, and monotonically increasing
request ID must all match a live ref before a response may install. If the editable document changes
after a successful result, mark the comparison **out of date**, hide all derived counts/overlays,
and offer an explicit “Recompute match” action. Do not silently display a diff for a former
revision. If the response fails or is stale, retain the reference and clear only the derived result.

## 5. Backend and Tauri boundary

Feature 8 adds one real command rather than exposing a dormant generic matcher command:

```rust
#[tauri::command]
fn compare_external_midi(
    request: CrossImportComparisonRequestDto,
) -> Result<CrossImportComparisonResponseDto, AppError>;
```

```text
validate reference path and request document IDs
    -> read + parse the reference MIDI file
    -> materialize the supplied editable project already composed in TypeScript
    -> adapt both to MatchDocument
    -> discover + resolve CrossImportV1 candidates
    -> convert the immutable reference import and result into serializable DTOs
```

The frontend sends the _materialized_ editable project, not its base project plus overrides. This
matches the project displayed/exported by `materializeEditorProject`, ensures assignment evidence
uses the user’s current corrections, and keeps Rust from learning editor history or command state.

Suggested DTOs in `src-tauri/src/midi/model.rs`:

```rust
struct MatchDocumentRequestDto {
    document_id: String,
    project: MidiProjectDto,
}

struct CrossImportComparisonRequestDto {
    reference_path: String,
    reference_document_id: String,
    editable: MatchDocumentRequestDto,
}

struct ReferenceDocumentDto {
    document_id: String,
    path: String,
    project: MidiProjectDto,
    provenance: AssignmentProvenanceDto,
}

struct CrossImportComparisonResponseDto {
    reference: ReferenceDocumentDto,
    correspondence: CrossImportMatchResultDto,
}
```

`CrossImportMatchResultDto` mirrors only the `CrossImportV1` result. It uses camelCase field names,
`SCREAMING_SNAKE_CASE` versioned policy/reason enums, and `NoteRefDto { documentId, noteId }` on
every relationship. Rational score values cross JSON as reduced decimal strings (never JavaScript
numbers) because the Rust scoring numerator can exceed the safe integer range. The TypeScript
mirror lives in `src/lib/tauri/commands.ts`; matching logic never moves into TypeScript.

Before wiring the command, close the result-model gaps needed by the UI without retuning matching:

- propagate exact duplicate ambiguity groups from the strict subresult into the cross-import DTO;
- group fuzzy competing/tied candidates by conflict reason for display, while retaining their
  side-qualified candidate refs;
- expose policy metadata needed to explain the threshold/coverage decision;
- retain deterministic order in every emitted list.

`AppError` receives a dedicated structured error for invalid supplied matching input (for example,
invalid PPQ/timing in the materialized editable project). Path, extension, read, and parse errors
continue to use the established import error codes/messages. The command never writes a file,
mutates an editor document, or changes app-global import state.

## 6. Trusted pairs, voice correspondence, and cross-import diff

### 6.1 Two coverage concepts

Feature 7’s `comparable` status is semantic correspondence coverage: an equal exact duplicate
multiset can contribute multiplicity even though its individual occurrences cannot safely pair.
Feature 8 needs individual pairs to compute voice overlap. Therefore it must derive and display
both:

1. **Matcher coverage:** Feature 7’s exact/fuzzy/ambiguous/unmatched coverage and its
   `incomparable` decision.
2. **Trusted-pair coverage:** `exactPairs + fuzzyPairs` with unique side-qualified refs divided by
   each side’s total notes.

Only `exactPairs` and mutually unique `fuzzyPairs` are trusted. Duplicate-exact and fuzzy conflict
groups remain visible ambiguity; they never enter a voice-weight matrix. If either trusted-pair
coverage is below 50%, return a Feature-8 `insufficient_unambiguous_pairs` presentation state even
when Feature 7’s semantic result says `comparable`. This avoids an apparently authoritative voice
diff built from a tiny biased subset. The UI shows both facts, not a contradictory single percentage.

### 6.2 Pair-driven voice evidence

Extract the maximum-weight solver in `voiceCorrespondence.ts` from its local-ID overlap discovery:

```ts
interface VoiceOverlapEvidence {
  readonly aVoiceIds: readonly string[];
  readonly bVoiceIds: readonly string[];
  readonly overlapByPair: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly percussionOverlap: number;
}
```

Keep `correspondVoices(a, b)` as the existing local-ID adapter that builds this evidence from shared
IDs. Add `correspondVoicesFromPairs(reference, editable, trustedPairs)`, which resolves each pair’s
local assignment independently and builds the same evidence. The Hungarian solver, deterministic
sorting, ambiguity, split/merge reporting, and percussion role behavior then remain one tested
implementation.

This refactor must not alter current snapshot/A–B output. Existing `voiceCorrespondence.test.ts`,
`assignmentDiff.test.ts`, and compare-preview E2E coverage are regression gates for it.

### 6.3 Separate result shape

Do not coerce paired results into `AssignmentDiff`, whose bare note-ID lists are local to one
document. Add a pure `src/domain/midi/crossImportDiff.ts`:

```ts
interface CrossImportChangedPair {
  readonly reference: NoteRef;
  readonly editable: NoteRef;
  readonly referenceVoice: VoiceRef;
  readonly editableVoice: VoiceRef;
}

interface CrossImportAssignmentDiff {
  readonly comparable: true;
  readonly matcher: CrossImportMatchSummary;
  readonly trustedPairCoverage: { readonly reference: number; readonly editable: number };
  readonly changedPairs: readonly CrossImportChangedPair[];
  readonly matchedVoices: readonly CrossImportVoicePair[];
  readonly addedEditableVoices: readonly VoiceRef[];
  readonly removedReferenceVoices: readonly VoiceRef[];
  readonly ambiguous: readonly AmbiguousNoteGroup[];
  readonly unmatchedReference: readonly NoteRef[];
  readonly unmatchedEditable: readonly NoteRef[];
}

interface CrossImportDiffIncomparable {
  readonly comparable: false;
  readonly reason: "INSUFFICIENT_MATCHER_COVERAGE" | "INSUFFICIENT_UNAMBIGUOUS_PAIRS";
  readonly matcher: CrossImportMatchSummary;
}
```

For every trusted pair, a reassignment exists only when its reference voice does not map to its
editable voice through the derived voice correspondence. A one-sided/unmatched/ambiguous note is
never presented as a reassignment. Label deltas, lock preservation, confidence deltas, model-cost
comparison, and export-readiness “baseline diff” are intentionally absent: they carry assumptions
from a same-lineage comparison that are not valid here.

Helpers used by canvas overlays must select a side explicitly, e.g.
`changedNoteIdsForSide(diff, { documentId, side: "editable" })`. They validate the document ID
before returning local strings. No caller receives a cross-import `changedNoteIds: string[]` that it
could accidentally apply to the wrong project.

## 7. Workspace projection and UI behavior

### 7.1 Generalized projection

Replace the A/B-only `SideProjection` with a discriminated, two-pane projection while keeping the
editable branch type unchanged:

```ts
type ComparisonPaneId = BranchId | "reference";

type ComparisonPaneProjection =
  | {
      readonly kind: "editable";
      readonly side: BranchId;
      readonly document: EditorDocument;
      readonly editable: boolean; /* existing fields */
    }
  | {
      readonly kind: "reference";
      readonly side: "reference";
      readonly document: ReferenceDocument;
      readonly editable: false; /* project + palette only */
    };
```

For external reference mode, `current` is the canonical palette side and `reference` reuses a
current voice’s presentation key only when pair-driven voice correspondence proves that relation.
Unmatched reference voices retain their own stable keys. The projection never invents a reference
`revisionRef`, command handler, history, or active side.

Split selection is no longer assumed to share raw note IDs. Selecting notes in the editable pane
does not select a same-string ID in the reference. A later optional view-only “show paired note”
cue must map only through `CrossImportChangedPair`/trusted pairs and must not mutate either
selection set. In the first release the reference pane accepts viewport/seek interaction only;
all selection, paint, context assignment, keyboard mutation, and pitch-range callbacks are no-ops
under an explicit `readOnly` pane capability.

### 7.2 Entry and summary flow

Add “Compare external MIDI…” beside the existing snapshot selector in the **What changed?** panel;
do not reuse the main “Import MIDI” button. It opens the same native file chooser constraints
(`.mid`, `.midi`) but invokes `compare_external_midi`, not `import_midi`.

On success:

1. Preserve the current editable branch, snapshots, selection, undo history, and export state.
2. Store the immutable reference plus the guarded derived response.
3. Open an external-reference workspace in single `current` view, with a concise banner naming the
   reference file and buttons for Current / Reference / Diff / Split / Replace / Close.
4. Show a coverage-first summary. Match policy/version, exact/fuzzy/trusted counts, ambiguity, and
   unmatched counts come before reassignment/voice counts.

If the result is incomparable, Reference and Split remain available for inspection. Diff shows the
coverage explanation and raw diagnostics but no numbered reassignment, voice, or changed-note
claims. “Show changes” and “Only changed notes” are disabled with an explanatory reason.

### 7.3 Read-only behavior

The reference pane must visibly say **Reference · read-only**. It cannot activate `editorActiveSide`.
Pointer/canvas focus must not route number keys, paint tools, context assignments, undo/redo,
rerun, snapshot restore, voice-management controls, range markers, or export to the reference.
Clicking it may make its pane visually focused for accessibility but leaves the editable branch
active. This needs explicit tests because current split panes activate A or B on pointer down.

Reference playback is intentionally deferred in Feature 8. The shared transport continues to
monitor the editable branch, avoiding a new playback-scope mapping for unmatched reference notes.
The reference canvas still follows its visual playhead/seek policy only if that can be done without
changing the monitored source; otherwise seek/play controls remain scoped to the editable pane and
the reference clearly labels this limitation. A future playback feature may add reference audition
with a separate, explicit scope contract.

## 8. Commit-sized implementation slices

Every slice is independently reversible and ends in one focused commit. Do not amend a prior slice
to hide a regression; repair it in the next focused commit.

### Phase 0 — Complete and audit the handoff

**0.1 Feature 7 downstream contract test.** Land the planned F7 D1 pure fixture adapter. Assert
that trusted pairs form voice-overlap input; ambiguous/unmatched refs remain side-qualified; and
an incomparable matcher result cannot make cross-import counts. Keep it out of `App.tsx`.

Commit: `test: protect downstream note-correspondence contract`

**0.2 Result-shape audit.** Add the missing exact/fuzzy ambiguity grouping and deterministic DTO
conversion tests needed by Feature 8 without changing matching thresholds or pairing decisions.

Commit: `feat: prepare cross-import match result DTO`

### Phase A — Pure TypeScript adapters

**A1. Reference-document ownership.** Add immutable `ReferenceDocument`, opaque ID creation, and
the tagged external-reference workspace state. Test replacement/close lifecycle and prove it
cannot be constructed as an editable branch or named snapshot. Do not alter the UI yet.

Commit: `feat: add read-only reference document model`

**A2. Pair-driven voice correspondence.** Extract the shared Hungarian solver input; add the
trusted-pair evidence adapter. Prove legacy local-ID correspondence output is byte-for-byte
equivalent on existing fixtures, plus pair-ID-mismatch, split/merge, percussion, and ambiguity
cases.

Commit: `refactor: derive voice correspondence from trusted pairs`

**A3. Cross-import diff contract.** Add `crossImportDiff.ts`, trusted-pair coverage gating, and
side-qualified changed/unmatched/ambiguous output. Test same assignments under regenerated IDs,
one real reassignment, equal duplicate ambiguity, low semantic coverage, low trusted-pair coverage,
and input-order invariance. Add regression tests that `diffAssignments` remains unchanged.

Commit: `feat: add paired cross-import assignment diff`

### Phase B — Native import-and-match boundary

**B1. Serializable DTOs and command.** Add DTO conversions, `compare_external_midi`, command
registration, typed `commands.ts` mirror/wrapper, and command tests for path validation, parse
failure, matching error, exact PPQ-equivalent notes, and unrelated imports. The command returns a
reference plus result but performs no application mutation.

Commit: `feat: add cross-import comparison command`

**B2. Guarded comparison controller.** Add the narrow hook/controller that invokes B1 with the
materialized active document and applies responses only when request ID + branch + document ID +
revision still match. Test pending request/replacement, edit-during-request, reference replacement,
failure/retry, and result invalidation after a later edit.

Commit: `feat: guard external comparison results by revision`

### Phase C — Read-only workspace and diagnostics UI

**C1. Comparison projection generalization.** Extend projection/presentation-key helpers to model
an immutable reference pane, without changing snapshot/A–B behavior. Test current/reference single
view, split panes, palette mapping from trusted voice correspondence, and an unmatched reference
voice’s independent presentation key.

Commit: `refactor: project read-only reference comparisons`

**C2. Load/replace/close user flow.** Add the external-reference action, busy/error/out-of-date
states, file naming, and exclusion with editable B. Test the command payload contains the
materialized current project and that a failed/replaced load preserves the working editor.

Commit: `feat: load external MIDI as a comparison reference`

**C3. Coverage-first cross-import summary.** Render policy/version, matcher and trusted-pair
coverage, ambiguity, unmatched notes, and incomparable reasons. Render reassignment/voice counts
only under the dual coverage gate. Leave existing snapshot diff markup and strings intact.

Commit: `feat: show cross-import coverage and ambiguity`

**C4. Paired overlays and hard read-only authorization.** Add side-specific changed-note cues using
`NoteRef`, retain canvas viewport navigation, and block every reference-pane mutation path. Test
that reference pointer/keyboard interaction cannot change branch revision, selection, voices,
snapshots, or export data. Do not add reference playback in this slice.

Commit: `feat: render read-only cross-import diff panes`

### Phase D — End-to-end and manual acceptance

**D1. Browser journeys.** Extend the Tauri mock with `compare_external_midi`; cover comparable
regenerated IDs, unrelated input, duplicate ambiguity, stale response after edit, replace/close,
and reference-pane read-only behavior. Use exact accessible canvas labels—not `.editor-grid
canvas`. Run serial workers for playback-adjacent coverage.

Commit: `test: cover cross-import comparison journeys`

**D2. Native/manual evidence.** With the real Tauri command, compare an app export/reimport and an
unrelated MIDI. Record coverage, ambiguity, error recovery, split scrolling, readable labels, and
the inability to mutate the reference. This is a Feature 8 manual checkpoint; do not claim Feature
9 verification from it.

Commit: `docs: record cross-import comparison acceptance`

## 9. Verification matrix

### Narrow checks

- Rust matcher/DTO/command slices: `cargo test content_matching` and targeted
  `cargo test commands::midi::tests`.
- Pure diff/projection slices: `pnpm exec vitest run src/domain/midi/crossImportDiff.test.ts`,
  `src/domain/midi/voiceCorrespondence.test.ts`, and the relevant `src/app/editor/*.test.ts`.
- IPC mirror/controller slices: `pnpm exec vitest run src/lib/tauri/commands.test.ts` plus
  controller tests that resolve promises out of order.
- UI slices: targeted App/component tests and `pnpm exec tsc --noEmit`.
- E2E: `pnpm test:e2e -- --workers=1` for the new external-reference journey.

### Broad checks before every commit

```powershell
pnpm rust:test
cargo fmt --check
pnpm rust:check
pnpm rust:clippy
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm format:check
```

Run `pnpm build` outside the sandbox when DTO/command or frontend behavior crosses the runtime
boundary. If Vite/esbuild reports `spawn EPERM` inside the sandbox, record it and rerun the same
command with authorized external execution; it is not a product failure by itself.

### Required regression evidence

- Existing same-lineage snapshot diff still rejects disjoint local IDs exactly as before.
- Existing A/B branch remains independently editable, undoable, promotable, and discardable.
- Reference load never calls `resetSideA`, `forkSideB`, `import_midi`, or snapshot creation.
- A stale match never overwrites a newer reference or editor revision.
- Every note/voice relationship in cross-import output is side-qualified.
- Exact duplicate ambiguity never creates a trusted occurrence pair.
- A matcher-incomparable or trusted-pair-incomparable result produces no voice matching or
  reassignment count.
- The reference pane cannot mutate any editable state through pointer, keyboard, context menu,
  accessibility control, or async response.

## 10. Failure and rollback behavior

- Unsupported path, missing file, invalid MIDI, parse failure, and invalid editable matching input
  show a structured error; neither document changes.
- Low coverage and ambiguity are valid diagnostics, not exceptions. They retain both documents but
  suppress authoritative diff output.
- Replacing/closing the reference drops only the derived cross-import session. It never resets the
  primary editor, its snapshots, or A/B history.
- A rollback removes the external-reference workspace and command independently because no current
  local-ID comparison path was replaced.
- If the matcher contract needs a semantic change, introduce a new policy/matcher version with
  fixture evidence; Feature 8 must not weaken `CrossImportV1` to make a UI demo look better.

## 11. Decisions recorded for Feature 8

1. **Reference is immutable and not B.** Existing B remains an editable, snapshot-forked branch;
   an external file is a distinct read-only participant.
2. **One comparison mode at a time.** External reference and editable A/B workspaces are mutually
   exclusive in V1, preventing a three-pane state and accidental B mutation.
3. **Rust owns matching; TypeScript owns presentation.** Feature 8 publishes DTOs and pure
   pair-driven adapters but never reimplements content matching in the frontend.
4. **Two gates protect users.** Matcher coverage guards whether the imports are related at all;
   trusted-pair coverage guards whether voice/reassignment claims have enough individually known
   correspondence.
5. **No bare cross-import IDs.** All cross-document differences carry `NoteRef`/`VoiceRef`; local
   strings are extracted only after validating the side/document for rendering.
6. **No winner claim.** Cross-import coverage and assignment differences are diagnostic. Confidence,
   assignment cost, labels, locks, and export readiness do not become comparisons in this feature.
7. **Feature 9 receives strict semantics unchanged.** External-reference tolerance is never an
   export-verification fallback.

## 12. Handoff to Feature 9

Feature 8 will leave behind serializable note-correspondence DTOs, a real Rust command boundary,
trusted-pair adapters, and a tested distinction between semantic coverage and individually paired
coverage. Feature 9 may reuse only the DTO conversion and `StrictRoundTripV1` service against its
backend export→parse pipeline. It must not reuse the external file picker, reference workspace,
cross-import coverage gate, or tolerant fuzzy pairs to declare an export verified.
