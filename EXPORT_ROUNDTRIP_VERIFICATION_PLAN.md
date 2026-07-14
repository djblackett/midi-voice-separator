# Detailed Plan: Automated Export-to-Reimport Verification (Feature 9)

- Repository: `chiptune-voice-separator`
- Date: 2026-07-14
- Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (M16, M18),
  `CONTENT_BASED_NOTE_MATCHING_PLAN.md`, the existing exporter/parser, and
  Feature 8's immutable/reference ownership boundary.
- Status: architecture drafted; pure backend preparation may begin while the
  Feature 6 manual acceptance and Feature 8 UI work remain outstanding.

## 1. User outcome

After exporting the current materialized project, the app should say one of:

- **Verified:** the actual file written to disk reimports with the documented
  application model intact.
- **Differences found:** the file was written, but one or more supported model
  facts changed. The report names the facts; it never implies that the export
  failed to write.
- **Inconclusive:** strict note content is preserved, but duplicate occurrence
  ambiguity prevents a truthful claim about a voice partition.
- **Could not verify:** the write succeeded but the verifier could not read or
  parse the exact bytes at the destination. This is an actionable export result,
  not a reason to replace the current editor project.

`Verified` means the modeled application data round-tripped semantically. It
does not mean byte identity, preservation of every SMF event, musical quality,
or equivalence to an arbitrary external import.

## 2. Scope, gates, and non-goals

### Entry and sequencing

1. Feature 7's `StrictRoundTripV1` matcher is the only note matcher used here.
   `CrossImportV1`, fuzzy pairs, and Feature 8's coverage gate are forbidden
   from this path.
2. The backend-only audit, validation, exporter/parser repair, verifier, and
   IPC slices may proceed independently. They do not alter Feature 8's
   read-only comparison workspace.
3. The export-panel UI and browser/manual journeys wait for the recorded
   Feature 6 fullscreen/audio acceptance and Feature 8's C2--C4 UI completion.
   This prevents another large App/canvas interaction change while the existing
   browser regression is unresolved.
4. Begin every slice from a clean `git status --short`. Do not bundle Feature 8
   UI, matcher-policy tuning, or a broad MIDI metadata importer into this plan.

### Explicit non-goals

- Byte-for-byte SMF equality, original track/format layout, source-track IDs,
  note IDs, voice IDs, confidence/reason/lock/range state, or editor history.
- Acceptance of a near match: no timing tolerance, pitch transposition,
  channel substitution, or fuzzy correspondence.
- Replacing the working document with a reimport, creating a Feature 8
  `ReferenceDocument`, or making an external file editable.
- Preserving controllers, programs, pitch bend, SysEx, lyrics, key signatures,
  note-off velocity, or any unmodeled MIDI event.
- A general-purpose MIDI repair service. Unsupported source structures are
  reported deterministically rather than silently rewritten into `Verified`.

## 3. Verified starting point and fidelity audit

Today `export_midi` writes `export_midi_bytes(project)` and returns counts. It
does not read back its destination, invoke strict matching, or expose a
verification report. The exporter writes a conductor track plus one marked
voice track per listed voice, using a `Text` marker and the voice label as the
track name. The parser recognises marked tracks and regenerates local IDs.

The following current behaviors must be frozen in tests, then either repaired
or represented in the report before a successful export can claim `Verified`:

| Area                                      | Current behavior                                                                                                                                            | Feature 9 decision                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Note content / PPQ                        | Exporter emits note pitch, channel, velocity, start/end and PPQ; strict matcher normalizes PPQ rationally.                                                  | Verify exact canonical atoms and multiplicity with `StrictRoundTripV1`.                                                             |
| Duration / conductor metadata             | Exporter writes end-of-track at `durationTicks`, tempo, and time signatures.                                                                                | Verify PPQ, project duration, ordered tempo changes, and ordered time signatures exactly.                                           |
| Voice partition                           | Parser-local IDs regenerate; strict duplicate buckets may have no occurrence pairing.                                                                       | Verify a partition only from unambiguous strict pairs. Equal duplicate ambiguity becomes `Inconclusive`, never an invented pairing. |
| Empty voices                              | An empty marked track is currently not rebuilt as an editor voice on parse.                                                                                 | Repair parser/export metadata so marked empty voices survive with their label and role.                                             |
| Percussion                                | A marked non-empty percussion track can reimport as generic `voice-N`; its role is inferred from channel 10, but an empty voice has no notes to infer from. | Add explicit app-exported voice-role metadata so the `PERCUSSION` role also survives empty tracks deterministically.                |
| Duplicate labels                          | Generic parser label de-duplication can rewrite the second label.                                                                                           | Preserve duplicate labels on app-marked tracks; only generic imports receive display disambiguation.                                |
| Unlisted note voices                      | Exporter emits an `Unassigned` fallback track for unlisted IDs.                                                                                             | Return the actual emitted track count; validation/report explicitly identifies the extra exported voice track.                      |
| Zero-length notes                         | Exporter orders normal note-offs, zero-length note-on/off pairs, then normal note-ons at a shared tick.                                                     | Preserve this ordering and verify the zero-length note multiset through parse/reimport.                                             |
| Overlapping duplicate pitch/channel notes | FIFO reparse cannot in general preserve crossing end-pairings.                                                                                              | Detect before export and report a specific unsupported/inconclusive partition fidelity issue; never mark `Verified`.                |

The last item is a MIDI-event identity limitation, not a matcher weakness. No
ordering change can uniquely recover arbitrary crossing equal pitch/channel
occurrences after export. Its report must name the affected notes/voice without
pretending there is a safe occurrence identity.

## 4. Semantic contract

### 4.1 Supported verification model

The verifier checks only these facts:

```text
materialized project
  ppq, duration
  notes: pitch/channel/velocity/start/end multiset
  voice partition, only where strict occurrence correspondence is unambiguous
  voice label and explicit role after correspondence
  tempo changes and time signatures
```

The expected project is the same materialized project handed to export. It is
never reconstructed from base state plus overrides in Rust.

### 4.2 Verdict and report vocabulary

Add a versioned Rust-only core report, then serializable DTOs with
`camelCase` fields and `SCREAMING_SNAKE_CASE` enums:

```rust
enum RoundTripVerificationStatusDto {
    Verified,
    DifferencesFound,
    Inconclusive,
    CouldNotVerify,
}

struct RoundTripVerificationReportDto {
    verifier_version: u32,
    matcher_version: u32,
    policy: NoteMatchPolicyDto, // always STRICT_ROUND_TRIP_V1
    status: RoundTripVerificationStatusDto,
    note_summary: StrictNoteVerificationSummaryDto,
    voice_partition: VoicePartitionVerificationDto,
    metadata: TimelineMetadataVerificationDto,
    expected_transformations: Vec<ExpectedExportTransformationDto>,
    differences: Vec<RoundTripDifferenceDto>,
}
```

`ExpectedExportTransformation` describes a documented non-preserved input
field only when it is outside the supported model. It must not suppress a
supported-model difference. `RoundTripDifference` has stable categories such
as `MISSING_NOTE`, `UNEXPECTED_NOTE`, `AMBIGUOUS_DUPLICATE_PARTITION`,
`VOICE_PARTITION`, `VOICE_LABEL`, `VOICE_ROLE`, `PPQ`, `DURATION`, `TEMPO_MAP`,
`TIME_SIGNATURES`, and `OVERLAPPING_DUPLICATE_PAIRING`.

Every note address in a difference is document-qualified:

```rust
struct VerificationNoteRefDto {
    document_id: String, // "expected-export" or "reimported-export"
    note_id: String,
}
```

These are report addresses, not durable MIDI identity claims.

### 4.3 Strict note and partition rules

1. `match_strict_notes(expected, reimported)` establishes exact canonical
   content/multiplicity. Its duplicate exact groups count toward note-content
   preservation exactly as Feature 7 already specifies.
2. A missing or unexpected strict atom is a `DifferencesFound` result.
3. Only unambiguous strict occurrence pairs may feed partition/voice-label
   correspondence. No duplicate bucket is arbitrarily paired by order.
4. If duplicate ambiguity touches different expected or reimported voices, the
   report is `Inconclusive` for partition verification. If all occurrences in
   the bucket have the same matched voice role/label, a later conservative
   enhancement may prove that bucket; V1 reports it explicitly instead.
5. Voice IDs never participate in success. Matched voices compare explicit
   role and label; unmatched non-empty voices are a partition difference.
6. A report is `Verified` only if strict content, all supported metadata, and
   the verifiable partition are clean, with no unresolved unsupported-pairing
   issue.

### 4.4 Explicit voice roles

Feature 9 introduces `VoiceRoleDto { MELODIC, PERCUSSION }` on exported and
parsed voice DTOs. The existing literal `percussion` ID remains a compatibility
adapter while callers migrate; role becomes the verifier/exporter authority.

App-marked voice tracks receive an additional, versioned `Text` marker for
their role. The parser restores that role even when an exported track is empty.
Generic imports still infer percussion from channel 10. This is intentionally
not a claim that arbitrary MIDI track metadata has a stable voice role.

## 5. Backend pipeline and failure behavior

The authoritative command is still `export_midi`; verification is not a
separate best-effort command that can accidentally inspect a different file.

```text
validate materialized project
  -> encode export bytes
  -> write destination
  -> read destination bytes back
  -> parse actual bytes
  -> strict semantic verification
  -> return export metadata + report
```

- Validation, encode, and write failures remain `Err(AppError)` and do not
  create a verified result.
- Once writing succeeds, a read/parse/verification problem returns
  `ExportMidiResultDto` with `COULD_NOT_VERIFY`; it must not be disguised as a
  write failure or reset the editor.
- The command writes first and verifies the bytes read from `path`, not merely
  the in-memory encoded buffer.
- `ExportMidiResultDto.track_count` becomes the actual track count emitted,
  including a possible unlisted-voice track.
- `export_midi` never calls `import_midi` and never changes global editor,
  snapshots, Feature 8 reference state, or the active branch.

`AppError` gains focused input validation errors, for example
`INVALID_EXPORT_PROJECT`, for zero PPQ, a note ending before its start, values
that the exporter would otherwise clamp, duplicate/malformed voice metadata,
or an invalid materialized project shape. The report, not an error, owns valid
but unsupported overlapping duplicate-note pairing.

## 6. Frontend state and UI

The typed `exportMidi` response gains `verification`. Frontend types mirror
the DTO; they never reproduce strict matching in TypeScript.

`App.tsx` holds only a derived, revision-qualified last-export result:

```ts
interface ExportVerificationState {
  readonly branchId: BranchId;
  readonly documentId: DocumentId;
  readonly revision: number;
  readonly exportPath: string;
  readonly report: RoundTripVerificationReport;
}
```

Any later edit, undo/redo, re-run, import, branch switch, or reference-mode
transition hides the old status. The result does not become a snapshot,
baseline diff, export-readiness input, or a claim about Feature 8's reference.

The export panel displays a short status beside the completed export action:

- green **Verified application model**;
- amber **Differences found** or **Inconclusive**, with counts and a disclosure
  of categories; or
- red **Could not verify written file**, with a retry-export suggestion.

The current manual round-trip readiness reminder becomes a pre-export advisory,
not a post-export verification substitute. A successful report replaces it for
that exact revision. UI wording always says “application model”, never
“lossless”, “identical”, or “musically better”.

## 7. Commit-sized implementation slices

Every slice is reversible, begins clean, ends with one focused commit, and
runs its narrow checks before the broad suite.

### Phase 0 — Contract and current-fidelity audit

**0.1 Durable plan and fixture inventory.** Commit this plan. Add no runtime
behavior.

Commit: `docs: plan export round-trip verification`

**0.2 Freeze exporter/parser fidelity fixtures.** Add passing tests that
describe current normal round-trip behavior and targeted regression fixtures
for zero-length notes, crossing duplicate pitch/channel notes, empty voices,
percussion, duplicate labels, and unlisted voices. A fixture that exposes a
known failure is marked as an expected `Inconclusive`/difference target, not a
permanently failing test.

Commit: `test: inventory export round-trip fidelity cases`

### Phase A — Pure verification core

**A1. Versioned report and strict adapter.** Add the Rust verification module,
DTOs, document-qualified report references, and a pure adapter around
`StrictRoundTripV1`. Cover equal content across PPQ, changed atom fields,
missing/unexpected notes, equal duplicate multiset content, ordering
invariance, and proof that no tolerant matcher is callable here.

Commit: `feat: add strict round-trip verification report`

**A2. Metadata and partition verifier.** Compare PPQ/duration/tempo/time
signatures; derive voice correspondence only from unambiguous strict pairs;
report partition/label/role differences and duplicate partition ambiguity.

Commit: `feat: verify voice partition and timeline metadata`

**A3. Export-project preflight.** Validate before encoding instead of clamping
invalid values. Report unlisted-voice tracks and impossible overlapping
duplicate end-pairing deterministically without claiming success.

Commit: `feat: validate export projects for verification`

### Phase B — Export/parser fidelity repairs

**B1. Zero-length and emitted-track accounting.** Repair same-tick event order
for zero-length notes, return actual emitted track count, and prove ordinary
same-tick note transitions remain stable.

Commit: `fix: preserve zero-length notes through export`

**B2. App-exported voice roles and empty tracks.** Add role metadata to marked
tracks and parser recovery of empty/exported voices. Preserve duplicate labels
on marked tracks while retaining generic-import label disambiguation.

Commit: `feat: preserve exported voice roles and empty voices`

**B3. Unsupported duplicate-overlap diagnostic.** Detect crossing equal
pitch/channel overlap patterns and feed the exact report category. Do not use
event ordering as a hidden identity workaround.

Commit: `feat: report ambiguous duplicate-note round trips`

### Phase C — Real command and revision-scoped presentation

**C1. Verify the actual written file.** Extend `export_midi` to run the full
write/read/parse/verify pipeline and return a report on every successful
write. Add Tauri command tests for verified, differences, inconclusive,
readback failure, and unchanged input project.

Commit: `feat: verify written MIDI exports through IPC`

**C2. Typed frontend state.** Extend `commands.ts`, attach result state to the
export action, and guard it by branch/document/revision. Test a stale result
after edit/undo/branch switch cannot render.

Commit: `feat: track export verification by editor revision`

**C3. Export verification UI.** Render the concise status and details in the
export/readiness area. Preserve existing export behavior and disable no export
actions solely because verification is inconclusive.

Commit: `feat: show export round-trip verification`

### Phase D — End-to-end and manual evidence

**D1. Browser mock journeys.** Extend the Tauri mock and cover verified,
differences, inconclusive duplicate ambiguity, stale status after edit, and
accessible report wording. Use serial workers when this overlaps playback.

Commit: `test: cover export verification journeys`

**D2. Native/manual acceptance.** Export a normal project, zero-length fixture,
percussion/empty voice fixture, and duplicate-overlap fixture with real Tauri
IPC. Record whether each report is verified, difference, or inconclusive;
listen to the normal export but do not claim byte identity.

Commit: `docs: record export verification acceptance`

## 8. Verification matrix

### Narrow checks

- Core/report: `cargo test round_trip_verification` and
  `cargo test content_matching`.
- Export/parser repairs: `cargo test exporter` and `cargo test parser`.
- Command: `cargo test commands::midi::tests`.
- Frontend adapter/state: targeted Vitest files plus `pnpm exec tsc --noEmit`.
- UI: targeted App tests and `pnpm test:e2e -- --workers=1`.

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

Run `pnpm build` outside the sandbox for command/DTO/UI slices. Record any
Windows `spawn EPERM` sandbox block and rerun the same command externally; it
is an environment limitation, not a product result.

## 9. Required regression evidence

- Strict verification never invokes `CrossImportV1` and cannot accept a timing
  delta that tolerant comparison would accept.
- The verifier reads the destination bytes after write, not the in-memory
  buffer only.
- Local IDs, source track indexes, and voice IDs may change without failing a
  supported semantic report.
- A duplicate exact multiset may pass note content but cannot falsely verify a
  voice partition without unambiguous evidence.
- Percussion, empty marked voices, and duplicate labels receive a precise
  preserve/difference/inconclusive result.
- An unlisted voice changes the reported track count to the actual emitted
  count.
- Zero-length notes survive export/reparse without parser repair warnings.
- Crossing duplicate-note end pairing cannot be marked `Verified`.
- A failed readback never mutates the working editor or hides that the export
  file was written.
- A result from an older editor revision cannot appear after any edit, undo,
  redo, import, branch transition, or comparison-mode change.

## 10. Rollback and handoff

Each phase can roll back independently: the pure verifier has no command;
parser/exporter fixes retain their direct tests; the command enriches a result
without replacing export; UI state is derived and disposable.

Feature 10 or later work may consume the versioned report only as an export
fidelity fact. It must not reinterpret it as external-file equivalence,
assignment quality, or a substitute for Feature 8 coverage diagnostics.
