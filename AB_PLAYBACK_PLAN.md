# Detailed Plan: A/B Playback (Master-Plan Feature 5)

Repository: `chiptune-voice-separator`
Date: 2026-07-13
Consumes: `NEXT_FEATURES_MASTER_PLAN.md` (contracts M10, M11, M12), `SPLIT_SCREEN_PLAN.md` and
`KEYBOARD_COMMANDS_PLAN.md` (Features 3–4, complete).
Status: architecture drafted; implementation not started.
Verified entry boundary: Features 1–4 are complete. There is one editor document/command/history/
materializer, a two-branch hook with `activeSide`, a workspace projection with per-side
presentation keys, a split view, and a keyboard command registry. This plan begins from commit
`f52756c`.

---

## 1. Purpose and scope

Feature 3 shows A and B at once and colors matched voices alike; Feature 5 lets you **hear** them:
play the transport against side A or side B, switch which side you're monitoring **while playing**
(rescheduling from the current tick), and hear a matched B voice with the **same timbre** as its A
partner so real differences stand out by ear.

**In scope**

- **M10 (timbre half)** — the chiptune waveform per note comes from the voice's **presentation
  key**, not its raw id, so a matched B voice sounds like its A partner. (Feature 3 already did the
  color half.)
- **M12** — one transport with a replaceable **`PlaybackSource`**: the hook invalidates on a
  source/revision identity (not filename+duration), so switching sides reschedules; switching the
  monitored side while playing reschedules from the current tick, keeps Stop available, and
  visibly reports which side is sounding.
- **M11 (monitor side)** — a `monitorSide` in the workspace/projection, distinct from `activeSide`,
  so you can edit one side while auditioning either; render side, monitor side, timbre, playhead,
  and transport stay consistent.
- Resolve **solo and scope across sides** through correspondence — a soloed A voice maps to its
  matched B voice when monitoring B, or is explicitly dropped when it has no counterpart.

**Explicit non-goals**

- **Simultaneous A+B audio / per-pane engines** — one transport plays exactly one side at a time
  (the master plan's rejected design is two engines). You compare by _switching_, not by mixing.
- **Cross-import synchronized playback** — out of scope until timeline alignment has defined
  semantics (Feature 8+). Both sides here share one lineage and tempo map.
- **New instruments or an audio-engine rewrite** — the existing `PlaybackEngine` (chiptune +
  piano sampler) stays; only its note source and per-note waveform change.
- **A/B playback keyboard shortcuts** beyond reusing the existing transport keys — a dedicated
  "monitor other side" shortcut can be added later via the Feature 4 registry.

---

## 2. Current baseline (verified by reading)

- **One engine, but source-blind invalidation.** `usePlaybackEngine(project, soloVoiceId,
instrument, scope)` (`usePlaybackEngine.ts`) owns a single `PlaybackEngine` via `engineRef`.
  Its reset effect keys on `project?.fileName` and `project?.durationTicks` (line 182), so
  switching from A to B — same lineage, same filename and duration — does **not** reset or
  reschedule; the engine keeps sounding the previous side until the next Play/Seek. This is the
  M12 gap.
- **Timbre comes from the raw voice id.** `buildScheduledNotes` sets each note's `waveform =
waveformForVoice(note.voiceId)`, and `waveformForVoice(id) = WAVEFORMS[voiceColorIndex(id) % 3]`
  (`scheduledNotes.ts:42`). A matched B voice with a reallocated id therefore gets a different
  waveform than its A partner — the M10 timbre gap. Audition blips use the same function.
- **Playback follows the active side.** `App` calls `usePlaybackEngine(displayedProject,
soloVoiceId, instrument, playbackScope)`; `displayedProject` is the active branch's
  materialization. Both split panes already receive `currentPlaybackTick`, so the **playhead is
  shared**, but the audio is whatever was last scheduled.
- **Scope and solo are single-side.** `PlaybackScope` (`all|selected|voice|changed|around-note`)
  and `soloVoiceId` reference the active side's note/voice ids; `filterNotesForPlaybackScope`
  resolves them against one note list.
- **Rescheduling is already tick-accurate.** `startFrom(tick)` re-prepares and reschedules from an
  arbitrary tick (used by Seek), starting in-progress notes mid-way — exactly the primitive a
  monitored-side switch needs.

---

## 3. Target architecture (types and boundaries)

### 3.1 Presentation-key timbre (M10)

```ts
// scheduledNotes.ts
export function waveformForPresentationKey(key: string): Waveform; // = waveformForVoice today
export function buildScheduledNotes(
  notes,
  tempoMap,
  startTick,
  soloVoiceId,
  scope,
  presentationKeyByVoiceId?: ReadonlyMap<string, string>, // voiceId -> key; empty = identity
): ScheduledNote[];
```

Each note's waveform is derived from `presentationKeyByVoiceId.get(note.voiceId) ?? note.voiceId`.
A lone side passes an empty map (identity → today's waveforms); a monitored B side passes its
correspondence-derived map so matched voices sound like their A partners.

### 3.2 One transport, a replaceable `PlaybackSource` (M12)

```ts
// usePlaybackEngine.ts
export interface PlaybackSource {
  /** Side + branch revision identity. The transport reschedules when this changes. */
  readonly sourceId: string;
  readonly notes: readonly MidiNote[]; // materialized
  readonly ppq: number;
  readonly tempoChanges: readonly TempoChange[];
  readonly durationTicks: number;
  readonly soloVoiceId: string | null; // resolved for this side
  readonly scope: PlaybackScope; // resolved for this side
  readonly presentationKeyByVoiceId: ReadonlyMap<string, string>; // timbre
}

export function usePlaybackEngine(
  source: PlaybackSource | null,
  instrument?: Instrument,
): PlaybackControls;
```

The hook invalidates/stops on a genuinely new lineage (`durationTicks`/tempo differ) and — new —
**reschedules from the current tick when `sourceId` changes while `isPlaying`**. `sourceId`
encodes `${monitorSide}:${branchRevision}`, so both switching the monitored side and editing the
monitored side mid-play refresh the audio. Solo/scope/timbre all travel inside the source, so the
transport never reaches back into per-side state.

### 3.3 Monitored side in the projection (M11)

`ComparisonWorkspace` gains `monitorSide: "A" | "B"` (default follows `activeSide`). The projection
resolves a `PlaybackSource` for the monitored side, including the correspondence-mapped solo voice:

```ts
// comparisonProjection.ts (extended)
readonly monitorSide: BranchId;
readonly playbackSource: PlaybackSource; // built from the monitored side + presentation keys
```

`App` passes `projection.playbackSource` to `usePlaybackEngine`. Render side (`visibleSides`),
active side (edits), and monitor side (audio) are now all read from the one projection, so they
cannot silently diverge (M11 exit-gate).

### 3.4 Solo/scope resolution across sides

When the monitored side differs from where solo/scope were chosen, the projection remaps through
voice correspondence: a soloed A voice → its matched B voice, or `null` (with a visible
"solo has no match on B" note) when unmatched. Note-id scopes (`selected`/`changed`/`around-note`)
use shared note ids and carry over directly; `voice` scope remaps like solo.

---

## 4. Migration strategy

1. Add the presentation-key timbre parameter to `scheduledNotes` (identity default) — pure, no
   behavior change.
2. Refactor `usePlaybackEngine` to take a `PlaybackSource` with `App` building it from the active
   side (`sourceId = active:revision`, empty presentation map) — behavior-preserving, verified by
   the existing playback e2e.
3. Only then add `monitorSide`, the monitored-side `PlaybackSource` in the projection, the
   switch-while-playing reschedule, and the monitor UI.

No slice mixes "introduce the source" with "change what plays."

---

## 5. Commit-sized slices

### Phase A — Presentation-key timbre (M10, behavior-preserving)

- **A1. Waveform from a presentation key.** `buildScheduledNotes`/`buildAuditionNotes` accept an
  optional `presentationKeyByVoiceId` and derive the waveform through it; identity default keeps
  today's sound. Unit tests: a mapped voice takes its key's waveform; empty map is unchanged.

### Phase B — Transport takes a PlaybackSource (M12 core, behavior-preserving)

- **B1. `PlaybackSource` type + hook refactor.** `usePlaybackEngine(source, instrument)` invalidates
  on lineage and, while playing, reschedules from the current tick when `sourceId` changes. `App`
  builds the source from the active side (empty presentation map, solo/scope as today). Verified by
  the existing `playback.e2e` and scope/solo behavior.

### Phase C — Monitored side + switch while playing (M11/M12 feature)

- **C1. `monitorSide` in the workspace + projection `playbackSource`.** Default monitor = active;
  the projection materializes the monitored side and its presentation-key timbre map. `App` plays
  `projection.playbackSource`. In single view nothing changes (monitor = the one side).
- **C2. Monitor control + switch-while-playing UI.** A "Monitoring: A / B" control (split, and the
  A/B toggle in single view already moves it) that reschedules from the current tick, keeps Stop
  available, and shows the sounding side. Playwright: start playback on A, switch to monitor B
  mid-play — the playhead keeps advancing, Stop stays enabled, and the sounding source is B.
- **C3. Correspondence-resolved solo/scope.** Solo and `voice` scope remap through correspondence
  when monitoring the other side, dropping to `null` with a visible note when unmatched.

---

## 6. Contracts consumed, and where each is satisfied

| Contract                                     | Satisfied by                                        |
| -------------------------------------------- | --------------------------------------------------- |
| M10 timbre keys                              | A1 (render color half already shipped in Feature 3) |
| M12 one transport + replaceable source       | B1                                                  |
| M12 reschedule/stop/monitor-status on switch | B1 (reschedule), C2 (UI)                            |
| M12 invalidate on source/revision identity   | B1                                                  |
| M11 monitor side in one projection           | C1                                                  |
| solo/scope resolution across sides           | C3                                                  |

---

## 7. Verification strategy

- **Vitest:** waveform-through-presentation-key mapping (A1); `PlaybackSource` scope/solo filtering
  unchanged (B1); solo/`voice`-scope correspondence remap, including the unmatched→null case (C3);
  `sourceId` construction (side + revision).
- **Playwright:** existing playback (play/pause/stop/seek/scope) stays green after B1; switching the
  monitored side while playing keeps the playhead advancing and Stop available and reports the new
  side (C2); a matched B voice's monitored playback is not blocked/empty when A is soloed (C3).
- **Manual pause points:** A/B switch latency and clicks; matched-voice timbre consistency by ear
  on the two dense fixtures (the master plan's listed pause point).

### Mandatory regression scenarios (from the master plan) exercised here

- Matched voices retain chiptune timbre across the switch — A1 + C1.
- Switching the monitored side during playback never leaves hidden audio running without controls —
  C2 (one engine, reschedule, Stop always available, visible monitored side).
- Render side, monitor side, and timbre cannot diverge — C1 (all from one projection).

---

## 8. Rollback / failure behavior

- The transport already supersedes stale async prepares via `playRequestIdRef`; a monitored-side
  switch reuses `startFrom`, so a slow sample load during a switch cannot start stale audio.
- If a `PlaybackSource` is `null` (no project) the transport is idle, exactly as today.
- Presentation-key timbre is opt-in; an empty map is identity, so any wiring gap degrades to
  today's per-voice-id waveforms rather than silence.

---

## 9. Decisions (RESOLVED 2026-07-13)

1. **Monitor-follows-active with override.** Default `monitorSide = activeSide`; a split-only
   "Monitor A/B" control pins the audio to either side while editing. (Chosen over "monitor always
   equals active".)
2. **Unmatched solo drops to `null` with a visible note** ("soloed voice has no match on B")
   rather than silently playing everything.
3. **No dedicated monitor-switch shortcut** — reuse the transport controls + the monitor toggle; a
   key can be added later through the Feature 4 registry if wanted.

---

## 10. Verified boundary this plan hands forward

On completion: one transport driven by a `PlaybackSource` keyed on side+revision identity, with
presentation-key timbre and a monitored side resolved from the same projection that drives render
and edit — render/monitor/timbre/playhead/transport provably consistent. Feature 6 (voice-lane
parity) and beyond consume the presentation keys unchanged; Feature 8 (cross-import) later revisits
synchronized playback once timeline alignment is defined.
