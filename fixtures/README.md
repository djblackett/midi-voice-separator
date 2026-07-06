# Fixtures

`two-note-smoke.mid` is a tiny, hand-authored Standard MIDI File for manual smoke testing.
It is format 0, PPQ 480, with one track, a 120 BPM tempo event, a 4/4 time signature, and
two quarter-note events:

- C4, velocity 100, tick 0 to 480.
- E4, velocity 90, tick 480 to 960. This note ends via note-on velocity zero.

The fixture was generated from explicit SMF bytes in PowerShell, not copied from a song or
third-party source:

```powershell
$bytes = [byte[]](0x4D,0x54,0x68,0x64,0x00,0x00,0x00,0x06,0x00,0x00,0x00,0x01,0x01,0xE0,0x4D,0x54,0x72,0x6B,0x00,0x00,0x00,0x25,0x00,0xFF,0x51,0x03,0x07,0xA1,0x20,0x00,0xFF,0x58,0x04,0x04,0x02,0x18,0x08,0x00,0x90,0x3C,0x64,0x83,0x60,0x80,0x3C,0x00,0x00,0x90,0x40,0x5A,0x83,0x60,0x90,0x40,0x00,0x00,0xFF,0x2F,0x00)
Set-Content -LiteralPath fixtures\two-note-smoke.mid -Value $bytes -AsByteStream
```

Rust parser tests still construct their own small MIDI files programmatically with `midly`
so unit-test cases stay readable.

## `boss-battle-6-combined.mid`

A real, dense, non-synthetic MIDI file used to validate the voice-separation heuristic and
`AssignmentMode` against actual music rather than only hand-constructed or synthetic test
cases. Source: ["Boss Battle #6 (8 bit)"](https://opengameart.org/content/boss-battle-6-8-bit)
by cynicmusic on OpenGameArt, dedicated to the **public domain (CC0)**.

The pack this came from (`15_melodic_rpg_chiptunes_ogg`) ships two MIDI variants of the same
track; this is the "combined" one, chosen specifically because it collapses everything onto a
single track and a single MIDI channel — 1,231 notes, pitch range 24-79, up to 8 notes
overlapping at once, 0 parser warnings. With no channel signal left to lean on at all, it's a
harder and more realistic case than any synthetic fixture built so far: it isolates how well
pitch/timing-only separation (`RegisterPriority`/`Balanced`, `Greedy` vs. `Global`) does, since
`ChannelPriority`/`StrictChannel` have nothing to key off here and degenerate to a coin flip
between equally-"compatible" voices for every note.

Measured while validating `AssignmentMode::Global` against this fixture (see
`voice_assignment.rs`'s `windowed_tests`): `Global` found a lower total assignment cost than
`Greedy` on every strategy where channel information actually matters (11% lower on
`Balanced`, 9% lower on `RegisterPriority`), confirming the lookahead search's benefit holds on
real content and not just the constructed adversarial cases used to justify building it.

## `boss-battle-6-separate-tracks.mid`

The companion file to `boss-battle-6-combined.mid` above: the same source pack's other MIDI
variant of the same track, kept intact with its original 8 tracks and 13 distinct MIDI
channels rather than collapsed onto one. Same source and license (CC0,
["Boss Battle #6 (8 bit)"](https://opengameart.org/content/boss-battle-6-8-bit) by
cynicmusic on OpenGameArt). 3,770 notes, pitch range 24-93, up to 12 notes overlapping at
once, 0 parser warnings.

This is the complementary case to the combined file: reliable per-instrument channel signal
instead of none, which is the scenario `ChannelPriority`/`StrictChannel` are actually designed
for. Measured while validating against this fixture: those two strategies got dramatically
more decisive here (mean confidence 0.91-0.975, ~90-300 low-confidence notes) than
`Balanced`/`RegisterPriority` (~0.66-0.75 mean confidence, 770-1275 low-confidence notes),
confirming channel-based separation earns its keep when the channel signal it depends on is
actually present. `Global` again beat `Greedy` on total cost across all four strategies (up
to 31% lower on `Balanced`), the largest margin measured on any fixture so far.
