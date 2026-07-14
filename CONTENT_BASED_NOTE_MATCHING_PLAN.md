# Detailed Plan: Content-Based Note Matching (Master-Plan Feature 7)

Repository: `chiptune-voice-separator`
Date: 2026-07-13
Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (M8, M9, M16),
`VOICE_LANE_PARITY_PLAN.md` (Feature 6 boundary).
Status: architecture drafted; implementation not started.
Verified entry boundary: Feature 6 is implemented through `30d0d4f`, but its real browser
acceptance is blocked by a deterministic fullscreen split-lane pointer-interception regression
(107/108 serial Chromium tests passed) and its manual audio/ergonomics checklist is outstanding.
This plan may be reviewed now; do not begin its implementation until that Feature 6 regression is
fixed, the full E2E suite is green, and the Feature 6 manual acceptance is recorded.

---

## 1. Purpose and scope

Current assignment comparison is deliberately limited to one import lineage: it compares local note
IDs and refuses sides with too few shared IDs. That protects the app from calling unrelated imports
a diff, but it also means an exported MIDI reimport cannot be compared even when its musical notes
are equivalent. Parser-generated note IDs embed import-local information and are not content
identity.

Feature 7 creates the versioned **note correspondence service** that later features consume:

- Feature 8 will use its cross-import result to compare an editable branch with a read-only
  reference document.
- Feature 9 will use its strict result to verify supported export→parse semantics.
- Existing same-lineage comparison retains its efficient local-ID path until Feature 8 explicitly
  migrates it; this feature must not weaken the current disjoint-ID guard.

**In scope**

- A backend-owned, pure, deterministic matcher over supported note content.
- A canonical atom that normalizes tick positions to reduced rational quarter-note coordinates.
- Three explicit correspondence routes: local same-document IDs, strict round-trip content, and
  conservative cross-import content.
- Exact multisets, sparse tolerant candidates, ambiguity, unmatched notes, per-side coverage, and
  policy/matcher version in the result.
- Rust unit/fixture coverage and typed request/result DTOs ready for the later Tauri command.
- A minimal TypeScript mirror of the serializable DTOs and a pure result-formatting helper only if
  Feature 8 needs it; no comparison-import UI in this feature.

**Explicit non-goals**

- Loading a second MIDI file, a `ReferenceDocument`, or a cross-import screen (Feature 8 / M17).
- Replacing the local-ID logic in `assignmentDiff.ts`, changing existing snapshot comparison, or
  changing voice correspondence/presentation keys.
- Export validation UI, writing a file, or claiming any round trip is lossless (Feature 9 / M18).
- Matching unsupported MIDI events, tempo maps, track names, program changes, controller events,
  or byte streams.
- Treating a note ID, voice ID, source track index, lane row, canvas position, confidence, reason,
  selection, or viewport state as musical content identity.
- Hiding duplicate-note ambiguity with parser order, occurrence numbers, or a deterministic but
  unreported arbitrary pairing.

---

## 2. Current baseline and constraints

- `MidiNote.id` is an import-local lookup key. The Rust parser derives it while reading a track;
  reimporting regenerated output gives notes new IDs and can change source track indices.
- `assignmentDiff.ts` uses shared local IDs and a `MIN_SHARED_NOTE_RATIO` guard. Keep that guard in
  place until Feature 8 consumes the new correspondence result; it is the current protection
  against false cross-import comparisons.
- M8 already provides side-scoped TypeScript references:
  `NoteRef { documentId, noteId }` and `VoiceRef { sideId, voiceId }`. A correspondence pair must
  contain two such side-qualified references, never bare IDs that callers might compare across
  documents.
- M9 `correspondVoices` is a different layer: it consumes note overlap to relate voice groups.
  It must not be extended to infer note identity. Feature 8 will feed it only the unambiguous note
  pairs returned here.
- The frontend DTO uses JavaScript `number`; the parser/exporter uses `u64` ticks. Matching must
  therefore be canonical in Rust, before any JSON conversion can round large tick values.
- Feature 6's view geometry is irrelevant to content. Piano-roll and lane views produce editor
  commands against local notes; their rows, gutters, and viewport windows never enter a match.

---

## 3. Target architecture

### 3.1 Ownership and module boundaries

The canonical implementation belongs in Rust, next to parser/exporter semantics, so Feature 9 can
verify the exact same rules against encoded bytes. Do not implement an independent TypeScript
matcher and attempt to keep it in sync.

```text
src-tauri/src/midi/content_matching.rs     pure normalization and matching service
src-tauri/src/midi/model.rs                serializable policy/request/result DTOs
src-tauri/src/midi/mod.rs                  exports the pure service to commands/tests
src-tauri/src/commands/midi.rs             no public command in Feature 7; Feature 8 adds one
src/lib/tauri/commands.ts                  mirror only the DTOs a later IPC command returns
src/domain/midi/noteCorrespondence.ts      optional frontend display helpers; never matching logic
```

Feature 7 may expose a crate-visible service for Rust tests and later commands, but it must not add
a dormant file-picker command or a fake frontend integration. A command is introduced only with a
real Feature 8 caller. This keeps the matcher pure/unwired first and avoids storing derived match
results in editor/comparison state (M4).

### 3.2 Canonical supported note atom

The canonical atom is the complete set of note fields this app promises to preserve semantically:

```rust
struct CanonicalNoteAtom {
    pitch: u8,
    channel: u8,
    velocity: u8,
    start_quarters: RationalQuarter,
    end_quarters: RationalQuarter,
}

struct RationalQuarter {
    numerator: u64,
    denominator: u16, // reduced; denominator is derived from PPQ
}
```

For a tick `t` at PPQ `p`, normalize `t / p` by `gcd(t, p)`. Use checked conversion and return a
structured matcher error for invalid `ppq == 0` or invalid note timing (`end < start`); do not
silently saturate or use floating point. `durationTicks` is derivable and excluded. The atom also
excludes `id`, `voiceId`, `sourceTrackIndex`, assignment confidence, and assignment reason.

The input wrapper retains only side-local reference plus the fields needed to normalize:

```rust
struct MatchNote<'a> {
    note_ref: MatchNoteRef, // { document_id, note_id }, local address only
    note: &'a MidiNoteDto,
}

struct MatchDocument<'a> {
    document_id: String,
    ppq: u16,
    notes: &'a [MidiNoteDto],
}
```

`MatchDocument` is a matcher input, not a new mutable editor model. Feature 8 will adapt its
editable document and read-only reference document to it.

### 3.3 Policies and versioning

One enum selects a versioned, named policy; the result echoes it. Callers never pass an ad-hoc
boolean such as `tolerant: true`.

```rust
enum NoteMatchPolicy {
    SameDocumentV1,
    StrictRoundTripV1,
    CrossImportV1,
}

const NOTE_CORRESPONDENCE_MATCHER_VERSION: u32 = 1;
```

| Policy              | Use                             | Eligible pair                                                              | Accepted match                                                    |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `SameDocumentV1`    | Existing same-lineage branches  | same `documentId` and `noteId`                                             | local-ID pair; content is not inferred                            |
| `StrictRoundTripV1` | Feature 9 semantic verification | exact canonical atom                                                       | exact atom multiplicity only; no tolerance                        |
| `CrossImportV1`     | Feature 8 comparison            | identical pitch, onset delta ≤ 1/64 quarter, duration delta ≤ 1/64 quarter | exact first; then an unambiguous high-confidence sparse candidate |

For `CrossImportV1`, channel equality and velocity equality add confidence but are not hard
requirements: exported/related sources can alter them while preserving note timing/pitch. Pitch is
hard equality; transposition matching is intentionally out of scope. Candidate score is a versioned
lexicographic tuple: exactness, smaller normalized onset delta, smaller normalized duration delta,
same channel, then smaller velocity delta. The score is an explanation and confidence input, not a
hidden tie-breaker.

The policy also owns these conservative gates:

- `min_coverage_per_side = 0.50`; both sides must reach it for `comparable`.
- a fuzzy candidate must be the only eligible best candidate for both notes and have no equal-score
  alternative; otherwise it is ambiguous, not paired.
- exact atoms are drained before fuzzy candidates. This prevents a near match from stealing a note
  that has an exact counterpart.

Thresholds live alongside the policy version and are reported as policy metadata. Changing one is a
new policy or matcher version plus fixture evidence, never an invisible behavior tweak.

### 3.4 Result model: multiplicity before arbitrary pairing

```rust
struct NoteMatchResultDto {
    matcher_version: u32,
    policy: NoteMatchPolicy,
    comparable: bool,
    incomparable_reason: Option<IncomparableReason>,
    left_coverage: MatchCoverage,
    right_coverage: MatchCoverage,
    exact_pairs: Vec<MatchedNotePair>,
    fuzzy_pairs: Vec<FuzzyMatchedNotePair>,
    ambiguous: Vec<AmbiguousNoteGroup>,
    unmatched_left: Vec<MatchNoteRef>,
    unmatched_right: Vec<MatchNoteRef>,
}
```

Each `MatchedNotePair` has `left: MatchNoteRef` and `right: MatchNoteRef`. `FuzzyMatchedNotePair`
also includes normalized onset/duration deltas and a bounded confidence. `MatchCoverage` reports
total, exact, fuzzy, ambiguous, unmatched, and `matched / total` for its own side. Empty documents
are comparable only to empty documents; empty-versus-nonempty is `incomparable` with all existing
notes unmatched.

An `AmbiguousNoteGroup` retains the canonical atom or tolerant candidate signature plus all
candidate refs on both sides and its reason (`duplicate_exact_atom`, `tied_fuzzy_score`, or
`competing_fuzzy_candidates`). It is deliberately not converted to occurrence-indexed pairs. For
strict verification, equal duplicate multisets contribute to semantic multiplicity/coverage, but
the individual note references remain ambiguous; Feature 8 must not convert them into certain
reassignments.

The result is sorted by canonical content then side-qualified reference. Maps and hash iteration
never leak output order. A caller that sees `comparable: false` may display coverage diagnostics,
but must not calculate reassignment counts, voice correspondence, or a winner claim.

### 3.5 Matching algorithm

1. Validate PPQ/timing and canonicalize each side. Sort canonical entries by atom then local ref.
2. For `SameDocumentV1`, verify the document IDs match and pair only shared local IDs; different
   documents return `incomparable`, never fall through to content matching.
3. For strict/cross-import policies, group equal canonical atoms. Remove a one-to-one exact group
   as an exact pair. Equal groups with duplicate candidates are represented as an ambiguous exact
   group while their matched multiplicity is retained for coverage; unequal remainders are emitted
   unmatched after the later fuzzy pass (cross-import only).
4. `StrictRoundTripV1` ends here: no threshold, score, PPQ approximation, or fallback path may
   produce a match.
5. For `CrossImportV1`, construct only sparse candidate edges from unmatched notes that meet the
   hard pitch/onset/duration thresholds. Resolve a fuzzy edge only when it is mutually unique and
   strictly best. Emit all tied or competing candidates as an ambiguity group; do not let sort order
   select one.
6. Emit remaining notes as side-specific unmatched references. Compute independent left/right
   coverage. If either falls below 0.50, return `comparable: false` with
   `insufficient_coverage`; preserve diagnostics for the Feature 8 UI.

This is intentionally more conservative than M9's Hungarian voice matching. M9 may select a
globally optimal voice pair after it is given trusted note overlap. Note matching cannot manufacture
one-to-one note identity from duplicate or tied content merely to satisfy an optimizer.

---

## 4. Migration strategy

Introduce the service as a tested, backend-owned seam before any consumer switches to it.

1. Add canonical rational normalization and serializable types without touching `assignmentDiff`.
2. Add strict matching, duplicate multiset behavior, and PPQ-equivalence fixtures.
3. Add the separately named tolerant policy and its conservative ambiguity/coverage gates.
4. Add a thin same-document adapter that proves local-ID behavior remains separate from content
   matching. Do **not** replace `diffAssignments` yet.
5. Add DTO mirrors/documentation and a fixture corpus. Do not add a command until Feature 8 has a
   `ReferenceDocument` owner and a real UI consumer.

At every step the existing comparison continues to use local IDs. A failed match is data, not an
exceptional editor state: later callers show `incomparable` and preserve both documents unchanged.

---

## 5. Commit-sized vertical slices

Start every slice with `git status --short`. Run the narrow tests first, then the broad checks
before committing. Make exactly one focused commit after every completed slice.

### Phase A — Canonical content and strict multiset core

**A1. Canonical atom and reduced rational-quarter normalization.** Add
`content_matching.rs`, private input adapters, `RationalQuarter`, and stable output sorting.
Unit-test same time expressed at different PPQs, reduced fractions, zero length (when parser allows
it), invalid PPQ, invalid end-before-start, and input-order invariance. No command or frontend
change.

Commit: `feat: add canonical MIDI note content atoms`

**A2. Strict round-trip matcher.** Add `StrictRoundTripV1`, exact buckets, match result DTOs, and
strict unmatched reporting. Test equivalent content across PPQs, one changed field at a time,
permutation invariance, empty inputs, and that strict matching never accepts any tolerant delta.

Commit: `feat: add strict note correspondence matcher`

**A3. Exact duplicate multisets and ambiguity.** Add multiplicity accounting and explicit duplicate
ambiguity groups. Test equal duplicate multisets, unequal counts, duplicate notes with different
velocity/channel, overlapping notes, and no hidden occurrence-order pairing. Verify the result is
deterministic when parser input order changes.

Commit: `feat: report duplicate note-match ambiguity`

### Phase B — Cross-import policy

**B1. Versioned sparse tolerant candidates.** Add `CrossImportV1` with named normalized timing
thresholds, score components, and exact-first draining. Test boundary-inclusive and boundary-
exclusive onset/duration deltas, PPQ normalization, pitch mismatch, channel/velocity penalties,
and a near candidate never displacing an exact pair.

Commit: `feat: add conservative cross-import note matching`

**B2. Ambiguity and coverage gate.** Add mutual-unique fuzzy acceptance, tied/competing fuzzy
groups, per-side coverage, and `insufficient_coverage` results. Test 50% boundary behavior,
asymmetric note counts, unrelated imports, a related but edited file, and output-order invariance
with shuffled input on both sides.

Commit: `feat: gate cross-import matches by coverage`

### Phase C — Consumer-ready contract without premature UI

**C1. Same-document adapter and migration guard.** Add `SameDocumentV1` as a thin side-qualified
local-ID adapter. Add regression tests showing different document IDs cannot invoke it and that
`assignmentDiff.ts` still owns the existing disjoint-ID guard and output. No behavior change in the
current diff panel.

Commit: `feat: add same-document note correspondence adapter`

**C2. Typed boundary, fixtures, and documentation.** Mirror the serializable result/policy types at
the Tauri boundary only where a future command needs them; add stable Rust fixture files for
different PPQ, duplicate, related-tolerant, and unrelated cases. Update `agents.md`,
`NEXT_FEATURES_MASTER_PLAN.md`, `README.md`, and this plan with actual commands/results. Document
that Feature 8 consumes only paired unambiguous notes, while Feature 9 consumes strict multiset
semantics.

Commit: `docs: document content-based matching boundary`

### Phase D — Integration readiness check (no Feature 8 behavior)

**D1. Design-level contract test for downstream consumers.** Add a pure fixture-driven test adapter
that demonstrates: trusted pairs can form voice-overlap input; ambiguous/unmatched notes remain
side-qualified; and an `incomparable` result cannot be converted to assignment-diff counts. Keep
it in a domain test helper, not `App.tsx` and not a new comparison state field.

Commit: `test: protect downstream note-correspondence contract`

---

## 6. Verification strategy

### Narrow checks per slice

- `pnpm rust:test -- content_matching` (or the project’s equivalent targeted Cargo filter) for
  every matcher slice.
- `pnpm exec tsc --noEmit` whenever DTO mirrors change.
- Existing `src/domain/midi/assignmentDiff.test.ts` for C1 and D1, proving the guard was not
  relaxed.

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

Run `pnpm build` on the external-runtime path when a DTO crosses the frontend boundary. In this
environment an in-sandbox Vite/esbuild spawn may report `EPERM`; record it precisely and rerun the
authorized build outside the sandbox rather than treating it as a product failure.

There is no new UI in A–D, so no Playwright or manual audio pause is required for this feature’s
pure matcher slices. Do not claim native IPC coverage until Feature 8 introduces its command.

Required corpus assertions:

- order-invariance of both inputs and all emitted lists;
- exact equal content at PPQ 96, 480, and 960;
- every supported atom field matters under strict policy;
- duplicate multiplicity and ambiguity never collapse to arbitrary pairs;
- tolerant policy is unable to satisfy a strict request;
- low coverage becomes `incomparable`, not a sparse “diff”;
- local IDs never make two document IDs equivalent;
- no feature treats geometry/view state as content.

### Manual pause points

None for Feature 7 itself. Matching quality on genuinely related but non-identical real MIDI files
is a Feature 8 manual pause, because only that feature displays the coverage/ambiguity result to a
user. Feature 9 owns manual export/reimport inspection.

---

## 7. Failure, rollback, and compatibility behavior

- Invalid timing or PPQ returns a structured matcher error before any result is constructed;
  documents and editor branches remain unchanged.
- Unsupported/missing content is reported as unmatched or `incomparable`; it never becomes a
  guessed exact correspondence.
- Low coverage, duplicate ambiguity, and fuzzy ties are visible result states. Later UI may offer
  explanation but cannot quietly choose a pair.
- The matcher is pure and has no async/native mutation. If a future Feature 8 IPC request fails,
  its reference document and current editable branch remain intact; the UI reports failure and
  clears only derived match output.
- Each phase is independently revertible because current local-ID diffing remains wired unchanged.
  Do not roll back by changing note IDs or rewriting imports.

---

## 8. Decisions recorded for implementation

1. **Rust is authoritative.** One matcher serves later cross-import and round-trip paths; TypeScript
   mirrors wire types but does not reimplement the algorithm.
2. **Rational quarters, not floats.** PPQ normalization is exact and backend-owned.
3. **Conservative tolerant V1.** Exact pitch plus 1/64-quarter onset/duration bounds; channel and
   velocity influence confidence rather than identity eligibility. Any threshold change is versioned.
4. **Ambiguity wins over arbitrary determinism.** Results are deterministically ordered, but a tied
   content relationship is still reported ambiguous rather than fabricated as a certain pair.
5. **Feature 7 is pure/unwired.** No external file loading, reference-document ownership, UI, or
   export verification is pulled forward.
6. **Feature 6 acceptance remains a prerequisite.** This plan is durable planning evidence, not
   authorization to bypass the known real-browser regression.

---

## 9. Verified boundary handed to Feature 8

On completion, Feature 8 receives a deterministic, versioned correspondence service with exact
multiset semantics, conservative tolerant matching, side-qualified paired/unmatched references,
coverage, ambiguity, and an explicit `incomparable` state. It can introduce a read-only
`ReferenceDocument`, a real IPC command, and cross-import UI without changing editor-branch
ownership or guessing note identity. Feature 9 can reuse only `StrictRoundTripV1` against the
backend export→parse pipeline; it must never substitute `CrossImportV1` to make a corrupted export
look verified.
