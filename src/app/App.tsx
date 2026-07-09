import { useEffect, useMemo, useState } from "react";
import type { MidiProject } from "../domain/midi/midiProject";
import {
  formatMidiChannel,
  formatMidiWarningLocation,
  formatProjectSummary,
  formatSelectedNote,
  formatSelectionSummary,
  formatSeparationSummary,
  formatStrategySuggestion,
} from "../domain/midi/midiProject";
import { MidiImportButton } from "../features/midi-import/MidiImportButton";
import { selectAndImportMidi } from "../features/midi-import/importMidi";
import { listenForMidiFileDrop } from "../features/midi-import/dropImport";
import { MidiExportButton } from "../features/midi-export/MidiExportButton";
import { selectAndExportMidi } from "../features/midi-export/exportMidi";
import {
  PianoRoll,
  type InteractionMode,
  type PianoRollViewMode,
} from "../features/piano-roll/PianoRoll";
import {
  clampBrushRadius,
  DEFAULT_BRUSH_RADIUS,
  MAX_BRUSH_RADIUS,
  MIN_BRUSH_RADIUS,
  stepBrushRadius,
  type PaintTool,
} from "../features/piano-roll/paintBrush";
import { getVoiceFillColor } from "../features/piano-roll/drawPianoRoll";
import {
  clampWandReach,
  DEFAULT_WAND_REACH,
  MAX_WAND_REACH,
  MIN_WAND_REACH,
} from "../features/piano-roll/smartSelect";
import {
  getBackendStatus,
  importMidi,
  reassignVoices,
  type AppCommandError,
  type AssignmentMode,
  type ExportMidiResult,
  type SeparationStrategy,
} from "../lib/tauri/commands";
import {
  applyVoiceOverrides,
  voiceIdForNumber,
  type VoiceOverrides,
} from "../domain/midi/voiceAssignments";
import {
  buildVoiceList,
  mergeVoiceOverrides,
  nextVoiceId,
  reconcileVoiceOrderAfterReassign,
  seedVoiceLabelsFromImport,
} from "../domain/midi/voiceManagement";
import {
  applyReviewDecision,
  buildFlaggedNoteQueue,
  buildReviewProgress,
  findCurrentFlaggedNote,
  findNextFlaggedNoteId,
} from "../domain/midi/reviewQueue";
import {
  analyzeVoiceDiagnostics,
  buildSplitAllWidePitchRepair,
  buildSplitAllMixedChannelsRepair,
  buildSplitVoiceByChannelRepair,
  buildSplitVoiceByPitchRepair,
  formatSplitVoiceByChannelRepairLabel,
  formatSplitVoiceByPitchRepairLabel,
  flaggedNoteIdsForVoice,
  formatVoiceChannelDistribution,
  formatVoiceDiagnosticSummary,
  formatVoiceFlaggedReviewLabel,
  noteIdsForVoice,
  recommendSeparationAction,
  sortVoiceDiagnosticsForDisplay,
} from "../domain/midi/voiceDiagnostics";
import {
  applyRangePatchPreservingHandCorrections,
  buildDefaultPitchMarkers,
  buildDefaultVoiceRangeRules,
  buildVoiceOverridesFromRangeRules,
  clampMidiPitch,
  describePitchRangeRule,
  type PitchMarker,
} from "../domain/midi/rangeRules";
import {
  createEditorHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type EditorHistoryState,
} from "./editorHistory";
import {
  appendSnapshot,
  createNamedSnapshot,
  formatSnapshotSummary,
  formatSnapshotTimestamp,
  restoreEditorState,
  type NamedSnapshot,
  type RerunSettings,
} from "./editorSnapshots";
import {
  buildComparePreview,
  createCompareState,
  editorSnapshotFromCurrent,
  isEditingDisabledForCompare,
  mapSoloVoiceForPreview,
  updateCompareViewing,
  type CompareState,
  type CompareViewing,
} from "./editorCompare";
import {
  diffAssignments,
  formatConfidenceDelta,
  formatOnlyInOneSideSummary,
  formatPercussionDelta,
  toDiffSide,
} from "../domain/midi/assignmentDiff";
import { buildTempoMap, tickToSeconds } from "../domain/midi/tempoMap";
import {
  buildExportReadinessSummary,
  formatExportReadinessStatus,
} from "../domain/midi/exportReadiness";
import { formatPlaybackTime } from "../features/playback/formatPlaybackTime";
import type { Instrument } from "../features/playback/playbackEngine";
import { usePlaybackEngine } from "../features/playback/usePlaybackEngine";
import type { PlaybackScope } from "../features/playback/scheduledNotes";

function getErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

function toAppCommandError(commandError: unknown): AppCommandError {
  return typeof commandError === "object" &&
    commandError !== null &&
    "code" in commandError &&
    "message" in commandError &&
    typeof commandError.code === "string" &&
    typeof commandError.message === "string"
    ? { code: commandError.code, message: commandError.message }
    : { code: "UNKNOWN_ERROR", message: getErrorMessage(commandError) };
}

type PlaybackScopeMode = "all" | "selected" | "voice" | "changed" | "flagged";

const FLAGGED_PLAYBACK_WINDOW_TICKS = 960;

function parseMaxVoiceCount(input: string): number | undefined {
  const parsed = Number.parseInt(input, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default function App() {
  const [project, setProject] = useState<MidiProject | null>(null);
  const [status, setStatus] = useState("Checking backend...");
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isReassigning, setIsReassigning] = useState(false);
  const [error, setError] = useState<AppCommandError | null>(null);
  const [exportError, setExportError] = useState<AppCommandError | null>(null);
  const [reassignError, setReassignError] = useState<AppCommandError | null>(null);
  const [exportResult, setExportResult] = useState<ExportMidiResult | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [skippedReviewNoteIds, setSkippedReviewNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [voiceOverrides, setVoiceOverrides] = useState<VoiceOverrides>({});
  const [voiceOrder, setVoiceOrder] = useState<string[]>([]);
  const [voiceLabels, setVoiceLabels] = useState<Record<string, string>>({});
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [soloVoiceId, setSoloVoiceId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("select");
  const [paintTool, setPaintTool] = useState<PaintTool>("brush");
  const [brushRadius, setBrushRadius] = useState(DEFAULT_BRUSH_RADIUS);
  const [wandReach, setWandReach] = useState(DEFAULT_WAND_REACH);
  const [pianoRollViewMode, setPianoRollViewMode] = useState<PianoRollViewMode>("piano");
  const [pitchMarkers, setPitchMarkers] = useState<PitchMarker[]>([]);
  const [rangeAssignedNoteIds, setRangeAssignedNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [history, setHistory] = useState<EditorHistoryState>(createEditorHistory());
  const [maxVoiceCountInput, setMaxVoiceCountInput] = useState("");
  const [separationStrategy, setSeparationStrategy] = useState<SeparationStrategy>("BALANCED");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("GREEDY");
  const [isDragOver, setIsDragOver] = useState(false);
  const [instrument, setInstrument] = useState<Instrument>("chiptune");
  const [playbackScopeMode, setPlaybackScopeMode] = useState<PlaybackScopeMode>("all");
  const [namedSnapshots, setNamedSnapshots] = useState<NamedSnapshot[]>([]);
  const [snapshotNameDraft, setSnapshotNameDraft] = useState("");
  const [diffTargetId, setDiffTargetId] = useState("");
  const [showChangedNotes, setShowChangedNotes] = useState(false);
  const [onlyChangedNotes, setOnlyChangedNotes] = useState(false);
  const [compareState, setCompareState] = useState<CompareState | null>(null);
  const displayedProject = useMemo(() => {
    if (!project) {
      return null;
    }
    const withOverrides = applyVoiceOverrides(project, voiceOverrides);
    return {
      ...withOverrides,
      voices: buildVoiceList(voiceOrder, voiceLabels, withOverrides.notes),
    };
  }, [project, voiceOverrides, voiceOrder, voiceLabels]);
  const selectedNotes = useMemo(
    () => displayedProject?.notes.filter((note) => selectedNoteIds.has(note.id)) ?? [],
    [displayedProject, selectedNoteIds],
  );
  const selectedNote = selectedNotes.length === 1 ? selectedNotes[0] : null;
  const flaggedNotes = useMemo(
    () => buildFlaggedNoteQueue(displayedProject?.notes ?? []),
    [displayedProject],
  );
  const currentFlaggedNote = useMemo(
    () => findCurrentFlaggedNote(flaggedNotes, selectedNoteIds),
    [flaggedNotes, selectedNoteIds],
  );
  const reviewProgress = useMemo(
    () => buildReviewProgress(flaggedNotes, voiceOverrides, skippedReviewNoteIds),
    [flaggedNotes, voiceOverrides, skippedReviewNoteIds],
  );
  const voiceRangeRules = useMemo(
    () => buildDefaultVoiceRangeRules(displayedProject?.voices.map((voice) => voice.id) ?? []),
    [displayedProject],
  );
  const voiceDiagnostics = useMemo(
    () => (displayedProject ? analyzeVoiceDiagnostics(displayedProject) : []),
    [displayedProject],
  );
  const sortedVoiceDiagnostics = useMemo(
    () => sortVoiceDiagnosticsForDisplay(voiceDiagnostics),
    [voiceDiagnostics],
  );
  const voiceSplitPreviews = useMemo(() => {
    const previews = new Map<
      string,
      {
        channelRepair: ReturnType<typeof buildSplitVoiceByChannelRepair>;
        pitchRepair: ReturnType<typeof buildSplitVoiceByPitchRepair>;
      }
    >();
    if (!displayedProject) {
      return previews;
    }

    for (const diagnostic of voiceDiagnostics) {
      previews.set(diagnostic.voiceId, {
        channelRepair: buildSplitVoiceByChannelRepair(
          displayedProject.notes,
          voiceOrder,
          diagnostic.voiceId,
        ),
        pitchRepair: diagnostic.suspicious
          ? buildSplitVoiceByPitchRepair(displayedProject.notes, voiceOrder, diagnostic.voiceId)
          : null,
      });
    }
    return previews;
  }, [displayedProject, voiceDiagnostics, voiceOrder]);
  const flaggedNoteIdsByVoice = useMemo(() => {
    const noteIdsByVoice = new Map<string, string[]>();
    if (!displayedProject) {
      return noteIdsByVoice;
    }

    for (const diagnostic of voiceDiagnostics) {
      noteIdsByVoice.set(
        diagnostic.voiceId,
        flaggedNoteIdsForVoice(displayedProject.notes, diagnostic.voiceId),
      );
    }
    return noteIdsByVoice;
  }, [displayedProject, voiceDiagnostics]);
  const channelSplitVoiceIds = sortedVoiceDiagnostics
    .filter((diagnostic) => voiceSplitPreviews.get(diagnostic.voiceId)?.channelRepair)
    .map((diagnostic) => diagnostic.voiceId);
  const pitchSplitVoiceIds = sortedVoiceDiagnostics
    .filter((diagnostic) => voiceSplitPreviews.get(diagnostic.voiceId)?.pitchRepair)
    .map((diagnostic) => diagnostic.voiceId);
  const suspiciousVoiceCount = voiceDiagnostics.filter(
    (diagnostic) => diagnostic.suspicious,
  ).length;
  const selectedMaxVoiceCount = parseMaxVoiceCount(maxVoiceCountInput);
  const separationRecommendation = displayedProject
    ? recommendSeparationAction(displayedProject, voiceDiagnostics, selectedMaxVoiceCount)
    : null;
  const currentRerunSettings = useMemo(
    () => ({
      strategy: separationStrategy,
      assignmentMode,
      maxVoiceCount: selectedMaxVoiceCount ?? null,
    }),
    [separationStrategy, assignmentMode, selectedMaxVoiceCount],
  );
  const importSnapshot = namedSnapshots.find((entry) => entry.source === "import");
  const mostRecentSnapshot =
    namedSnapshots.length > 0 ? namedSnapshots[namedSnapshots.length - 1] : undefined;
  const diffTarget = namedSnapshots.find((entry) => entry.id === diffTargetId) ?? null;
  // Diffs the selected snapshot (the reference/"before" side) against the
  // live current state ("after"), never a raw project or override map
  // alone (C6) -- toDiffSide reconstructs the same displayed composition
  // App.tsx itself renders.
  const assignmentDiffResult = useMemo(() => {
    if (!diffTarget) {
      return null;
    }
    const targetSide = toDiffSide(diffTarget.state, diffTarget.rerunSettings);
    const currentSide = toDiffSide(
      { project, voiceOverrides, voiceOrder, voiceLabels },
      currentRerunSettings,
    );
    if (!targetSide || !currentSide) {
      return null;
    }
    return diffAssignments(targetSide, currentSide);
  }, [diffTarget, project, voiceOverrides, voiceOrder, voiceLabels, currentRerunSettings]);
  const exportReadinessSummary = useMemo(
    () =>
      buildExportReadinessSummary({
        project: displayedProject,
        reviewProgress,
        baselineDiff:
          assignmentDiffResult && assignmentDiffResult.comparable ? assignmentDiffResult : null,
        lockedNoteIds: new Set(Object.keys(voiceOverrides)),
      }),
    [displayedProject, reviewProgress, assignmentDiffResult, voiceOverrides],
  );
  // The diff target's own materialized assignments -- the "before" side's
  // noteId -> voiceId map, reused directly as the changed-note overlay's
  // "previous voice" lookup rather than recomputing it from the diff
  // result. Depends only on diffTarget (not the live editor state), since
  // it's always the target/"before" side.
  const changedNotePreviousVoiceId = useMemo(() => {
    if (!diffTarget) {
      return new Map<string, string>();
    }
    const targetSide = toDiffSide(diffTarget.state, diffTarget.rerunSettings);
    return targetSide?.assignments ?? new Map<string, string>();
  }, [diffTarget]);
  const isDiffPreview = compareState?.viewing === "diff";
  const pianoRollChangedNoteIds = useMemo(() => {
    if (
      (!showChangedNotes && !isDiffPreview) ||
      !assignmentDiffResult ||
      !assignmentDiffResult.comparable
    ) {
      return new Set<string>();
    }
    return new Set(assignmentDiffResult.changedNoteIds);
  }, [showChangedNotes, isDiffPreview, assignmentDiffResult]);
  const canShowChangedNotes =
    assignmentDiffResult !== null &&
    assignmentDiffResult.comparable &&
    assignmentDiffResult.changedNoteIds.length > 0;
  const pianoRollOnlyChangedNotes =
    showChangedNotes && onlyChangedNotes && pianoRollChangedNoteIds.size > 0;
  const currentCompareState = useMemo(
    () => ({
      ...editorSnapshotFromCurrent({
        project,
        voiceOverrides,
        voiceOrder,
        voiceLabels,
        rangeAssignedNoteIds,
      }),
      rerunSettings: currentRerunSettings,
    }),
    [project, voiceOverrides, voiceOrder, voiceLabels, rangeAssignedNoteIds, currentRerunSettings],
  );
  const comparePreview = useMemo(
    () => buildComparePreview(compareState, namedSnapshots, currentCompareState),
    [compareState, namedSnapshots, currentCompareState],
  );
  const isCompareReadOnly = isEditingDisabledForCompare(compareState);
  const pianoRollProject =
    compareState?.viewing === "B" ? comparePreview.project : displayedProject;
  const pianoRollSoloVoiceId =
    compareState?.viewing === "B"
      ? mapSoloVoiceForPreview(soloVoiceId, comparePreview.matching)
      : soloVoiceId;
  const flaggedNoteIdSet = useMemo(
    () => new Set(flaggedNotes.map((note) => note.id)),
    [flaggedNotes],
  );
  const currentFlaggedNoteId =
    selectedNote && flaggedNoteIdSet.has(selectedNote.id) ? selectedNote.id : null;
  const playbackChangedNoteIds = useMemo(() => {
    if (!assignmentDiffResult || !assignmentDiffResult.comparable) {
      return new Set<string>();
    }
    return new Set(assignmentDiffResult.changedNoteIds);
  }, [assignmentDiffResult]);
  const canUseChangedPlaybackScope = playbackChangedNoteIds.size > 0;
  const canUseVoicePlaybackScope = activeVoiceId !== null;
  const canUseFlaggedPlaybackScope = currentFlaggedNoteId !== null;
  const playbackScope = useMemo<PlaybackScope>(() => {
    switch (playbackScopeMode) {
      case "selected":
        return { type: "selected", noteIds: selectedNoteIds };
      case "voice":
        return { type: "voice", voiceId: activeVoiceId };
      case "changed":
        return { type: "changed", noteIds: playbackChangedNoteIds };
      case "flagged":
        return {
          type: "around-note",
          noteId: currentFlaggedNoteId,
          beforeTicks: FLAGGED_PLAYBACK_WINDOW_TICKS,
          afterTicks: FLAGGED_PLAYBACK_WINDOW_TICKS,
        };
      case "all":
      default:
        return { type: "all" };
    }
  }, [
    playbackScopeMode,
    selectedNoteIds,
    activeVoiceId,
    playbackChangedNoteIds,
    currentFlaggedNoteId,
  ]);
  const pianoRollVoiceDescriptions = useMemo(() => {
    const descriptions = new Map<string, string>();
    if (compareState?.viewing !== "B" || !comparePreview.matching || !displayedProject) {
      return descriptions;
    }
    const currentLabelById = new Map(
      displayedProject.voices.map((voice) => [voice.id, voice.label]),
    );
    for (const match of comparePreview.matching.matched) {
      descriptions.set(
        match.afterVoiceId,
        `Matches ${currentLabelById.get(match.beforeVoiceId) ?? match.beforeVoiceId}`,
      );
    }
    for (const voice of pianoRollProject?.voices ?? []) {
      if (!descriptions.has(voice.id)) {
        descriptions.set(voice.id, "New in preview");
      }
    }
    return descriptions;
  }, [compareState, comparePreview.matching, displayedProject, pianoRollProject]);
  const playback = usePlaybackEngine(displayedProject, soloVoiceId, instrument, playbackScope);
  const tempoMap = useMemo(
    () => buildTempoMap(displayedProject?.tempoChanges ?? [], displayedProject?.ppq ?? 480),
    [displayedProject],
  );
  const playbackCurrentSeconds = tickToSeconds(tempoMap, playback.currentTick);
  const playbackDurationSeconds = tickToSeconds(tempoMap, displayedProject?.durationTicks ?? 0);

  useEffect(() => {
    if (playbackScopeMode === "changed" && !canUseChangedPlaybackScope) {
      setPlaybackScopeMode("all");
    } else if (playbackScopeMode === "voice" && !canUseVoicePlaybackScope) {
      setPlaybackScopeMode("all");
    } else if (playbackScopeMode === "flagged" && !canUseFlaggedPlaybackScope) {
      setPlaybackScopeMode("all");
    }
  }, [
    playbackScopeMode,
    canUseChangedPlaybackScope,
    canUseVoicePlaybackScope,
    canUseFlaggedPlaybackScope,
  ]);
  useEffect(() => {
    void getBackendStatus()
      .then((backendStatus) =>
        setStatus(`${backendStatus.application} backend ${backendStatus.status}`),
      )
      .catch((commandError: unknown) => setStatus(getErrorMessage(commandError)));
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (event.key === "Escape") {
        if (interactionMode === "paint") {
          setInteractionMode("select");
        } else {
          setSelectedNoteIds(new Set());
        }
        return;
      }

      if (isCompareReadOnly) {
        return;
      }

      if (event.key === "Tab" && flaggedNotes.length > 0) {
        event.preventDefault();
        const currentStartTick = selectedNote ? selectedNote.startTick : null;
        const nextId = findNextFlaggedNoteId(
          flaggedNotes,
          currentStartTick,
          event.shiftKey ? -1 : 1,
        );
        if (nextId) {
          setSelectedNoteIds(new Set([nextId]));
        }
        return;
      }

      // Paint-tool shortcuts, Photoshop-style: P(encil)/B(rush)/L(asso)/
      // W(and) switch tools (entering paint mode if needed); pressing the
      // active tool's key again exits back to select mode.
      const paintToolForKey: Record<string, PaintTool> = {
        p: "pencil",
        b: "brush",
        l: "lasso",
        w: "wand",
      };
      const shortcutTool = paintToolForKey[event.key.toLowerCase()];
      if (displayedProject && shortcutTool && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (interactionMode === "paint" && paintTool === shortcutTool) {
          setInteractionMode("select");
        } else {
          setPaintTool(shortcutTool);
          setInteractionMode("paint");
        }
        return;
      }

      if (
        interactionMode === "paint" &&
        paintTool === "brush" &&
        (event.key === "[" || event.key === "]")
      ) {
        event.preventDefault();
        setBrushRadius((radius) => stepBrushRadius(radius, event.key === "]" ? 1 : -1));
        return;
      }

      if (!displayedProject || !/^[1-9]$/.test(event.key)) {
        return;
      }

      const targetVoiceId = voiceIdForNumber(displayedProject, Number(event.key));
      if (!targetVoiceId) {
        return;
      }

      event.preventDefault();

      if (interactionMode === "paint") {
        setActiveVoiceId(targetVoiceId);
        return;
      }

      if (selectedNoteIds.size === 0) {
        return;
      }

      pushHistorySnapshot();
      setVoiceOverrides((currentOverrides) => {
        const nextOverrides = { ...currentOverrides };
        for (const noteId of selectedNoteIds) {
          nextOverrides[noteId] = targetVoiceId;
        }
        return nextOverrides;
      });
      setRangeAssignedNoteIds((current) => {
        const next = new Set(current);
        for (const noteId of selectedNoteIds) {
          next.delete(noteId);
        }
        return next;
      });
      setExportResult(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    displayedProject,
    selectedNoteIds,
    selectedNote,
    flaggedNotes,
    interactionMode,
    paintTool,
    history,
    voiceOverrides,
    voiceOrder,
    voiceLabels,
    isCompareReadOnly,
  ]);

  useEffect(() => {
    // The listener registration is itself async (it's real Tauri IPC), so
    // a cleanup that runs before it resolves (e.g. React StrictMode's
    // double-invoke in development, or this effect's own dependencies
    // changing again quickly) must still unlisten once it does resolve --
    // otherwise the earlier listener leaks and drops end up double-handled.
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listenForMidiFileDrop({
      onDragActive: setIsDragOver,
      onDrop: (path) => {
        if (isImporting || isExporting || isReassigning) {
          return;
        }
        void handleDroppedPath(path);
      },
    }).then((unlistenFn) => {
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isImporting, isExporting, isReassigning]);

  function applyImportedProject(importedProject: MidiProject) {
    const importVoiceOrder = importedProject.voices.map((voice) => voice.id);
    const importVoiceLabels = seedVoiceLabelsFromImport(importedProject.voices);

    setProject(importedProject);
    setSelectedNoteIds(new Set());
    setSkippedReviewNoteIds(new Set());
    setVoiceOverrides({});
    setVoiceOrder(importVoiceOrder);
    setVoiceLabels(importVoiceLabels);
    setSeparationStrategy(importedProject.strategySuggestion.strategy);
    setActiveVoiceId(null);
    setSoloVoiceId(null);
    setInteractionMode("select");
    setPitchMarkers(buildDefaultPitchMarkers(importedProject.notes));
    setRangeAssignedNoteIds(new Set());
    setHistory(createEditorHistory());
    setMaxVoiceCountInput("");
    setExportResult(null);
    setExportError(null);
    // A new import invalidates every prior snapshot: note ids embed the
    // source track index, so snapshots from a different import reference
    // ids this project can never contain (see editorSnapshots.ts C2).
    setNamedSnapshots([
      createNamedSnapshot(
        {
          project: importedProject,
          voiceOverrides: {},
          voiceOrder: importVoiceOrder,
          voiceLabels: importVoiceLabels,
          rangeAssignedNoteIds: new Set(),
        },
        {
          strategy: importedProject.strategySuggestion.strategy,
          assignmentMode: "GREEDY",
          maxVoiceCount: null,
        },
        "import",
      ),
    ]);
    setDiffTargetId("");
    setShowChangedNotes(false);
    setOnlyChangedNotes(false);
    setCompareState(null);
  }

  async function handleImport() {
    setIsImporting(true);
    setError(null);

    try {
      const importedProject = await selectAndImportMidi();
      if (importedProject) {
        applyImportedProject(importedProject);
      }
    } catch (commandError) {
      setError(toAppCommandError(commandError));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleDroppedPath(path: string) {
    setIsImporting(true);
    setError(null);

    try {
      applyImportedProject(await importMidi(path));
    } catch (commandError) {
      setError(toAppCommandError(commandError));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleExport() {
    if (!displayedProject) {
      return;
    }

    setIsExporting(true);
    setExportError(null);
    setExportResult(null);

    try {
      const result = await selectAndExportMidi(displayedProject);
      if (result) {
        setExportResult(result);
      }
    } catch (commandError) {
      setExportError(
        typeof commandError === "object" &&
          commandError !== null &&
          "code" in commandError &&
          "message" in commandError &&
          typeof commandError.code === "string" &&
          typeof commandError.message === "string"
          ? { code: commandError.code, message: commandError.message }
          : { code: "UNKNOWN_ERROR", message: getErrorMessage(commandError) },
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function handleReassign() {
    if (!project) {
      return;
    }

    const maxVoiceCount = parseMaxVoiceCount(maxVoiceCountInput);

    setIsReassigning(true);
    setReassignError(null);

    try {
      const reassignedProject = await reassignVoices(
        project,
        voiceOverrides,
        maxVoiceCount,
        separationStrategy,
        assignmentMode,
      );
      const rerunSettings: RerunSettings = {
        strategy: separationStrategy,
        assignmentMode,
        maxVoiceCount: maxVoiceCount ?? null,
      };
      // Captured from this closure's pre-mutation state, the same
      // discipline pushHistorySnapshot() below relies on: a failed
      // reassignVoices call above would have thrown, so no snapshot (auto
      // or undo) is recorded for a no-op re-run attempt.
      pushHistorySnapshot();
      setNamedSnapshots((current) =>
        appendSnapshot(
          current,
          createNamedSnapshot(
            { project, voiceOverrides, voiceOrder, voiceLabels, rangeAssignedNoteIds },
            rerunSettings,
            "before-rerun",
          ),
        ),
      );
      const nextVoiceOrder = reconcileVoiceOrderAfterReassign(
        voiceOrder,
        reassignedProject.notes.map((note) => note.voiceId),
      );
      setProject(reassignedProject);
      setSkippedReviewNoteIds(new Set());
      setVoiceOrder(nextVoiceOrder);
      setNamedSnapshots((current) =>
        appendSnapshot(
          current,
          createNamedSnapshot(
            {
              project: reassignedProject,
              voiceOverrides,
              voiceOrder: nextVoiceOrder,
              voiceLabels,
              rangeAssignedNoteIds,
            },
            rerunSettings,
            "after-rerun",
          ),
        ),
      );
      setExportResult(null);
    } catch (commandError) {
      setReassignError(
        typeof commandError === "object" &&
          commandError !== null &&
          "code" in commandError &&
          "message" in commandError &&
          typeof commandError.code === "string" &&
          typeof commandError.message === "string"
          ? { code: commandError.code, message: commandError.message }
          : { code: "UNKNOWN_ERROR", message: getErrorMessage(commandError) },
      );
    } finally {
      setIsReassigning(false);
    }
  }

  function pushHistorySnapshot() {
    setHistory((currentHistory) =>
      pushHistory(currentHistory, {
        project,
        voiceOverrides,
        voiceOrder,
        voiceLabels,
        rangeAssignedNoteIds,
      }),
    );
  }

  function handleUndo() {
    const result = undoHistory(history, {
      project,
      voiceOverrides,
      voiceOrder,
      voiceLabels,
      rangeAssignedNoteIds,
    });
    if (!result) {
      return;
    }
    setHistory(result.history);
    setProject(result.snapshot.project);
    setSkippedReviewNoteIds(new Set());
    setVoiceOverrides(result.snapshot.voiceOverrides);
    setVoiceOrder(result.snapshot.voiceOrder);
    setVoiceLabels(result.snapshot.voiceLabels);
    setRangeAssignedNoteIds(result.snapshot.rangeAssignedNoteIds);
    setExportResult(null);
  }

  function handleRedo() {
    const result = redoHistory(history, {
      project,
      voiceOverrides,
      voiceOrder,
      voiceLabels,
      rangeAssignedNoteIds,
    });
    if (!result) {
      return;
    }
    setHistory(result.history);
    setProject(result.snapshot.project);
    setSkippedReviewNoteIds(new Set());
    setVoiceOverrides(result.snapshot.voiceOverrides);
    setVoiceOrder(result.snapshot.voiceOrder);
    setVoiceLabels(result.snapshot.voiceLabels);
    setRangeAssignedNoteIds(result.snapshot.rangeAssignedNoteIds);
    setExportResult(null);
  }

  function handleSaveSnapshot() {
    if (!project) {
      return;
    }
    const name = snapshotNameDraft.trim();
    setNamedSnapshots((current) =>
      appendSnapshot(
        current,
        createNamedSnapshot(
          { project, voiceOverrides, voiceOrder, voiceLabels, rangeAssignedNoteIds },
          {
            strategy: separationStrategy,
            assignmentMode,
            maxVoiceCount: selectedMaxVoiceCount ?? null,
          },
          "manual",
          name === "" ? undefined : name,
        ),
      ),
    );
    setSnapshotNameDraft("");
  }

  // Restoring rewrites voiceOverrides, which doubles as the lock set the
  // next "Re-run separation" honors -- see editorSnapshots.ts C4. Goes
  // through pushHistorySnapshot() first so it is itself a normal undoable
  // action, same as every other mutating handler in this file.
  function handleRestoreSnapshot(snapshot: NamedSnapshot) {
    pushHistorySnapshot();
    const restored = restoreEditorState(snapshot);
    setProject(restored.project);
    setSkippedReviewNoteIds(new Set());
    setVoiceOverrides(restored.voiceOverrides);
    setVoiceOrder(restored.voiceOrder);
    setVoiceLabels(restored.voiceLabels);
    setRangeAssignedNoteIds(restored.rangeAssignedNoteIds);
    setSelectedNoteIds(new Set());
    setExportResult(null);
    setCompareState(null);
  }

  function handleRenameSnapshot(id: string, name: string) {
    setNamedSnapshots((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, name } : entry)),
    );
  }

  function handleDeleteSnapshot(id: string) {
    setNamedSnapshots((current) => current.filter((entry) => entry.id !== id));
    if (diffTargetId === id) {
      setDiffTargetId("");
      setShowChangedNotes(false);
      setOnlyChangedNotes(false);
      setCompareState(null);
    }
  }

  // Settings travel with a snapshot but only apply on request -- restoring
  // a snapshot deliberately leaves the Strategy/Search/Max-voices selectors
  // alone, since those are UI preferences, not corrigible editor state.
  function handleUseSnapshotSettings(snapshot: NamedSnapshot) {
    setSeparationStrategy(snapshot.rerunSettings.strategy);
    setAssignmentMode(snapshot.rerunSettings.assignmentMode);
    setMaxVoiceCountInput(
      snapshot.rerunSettings.maxVoiceCount === null
        ? ""
        : String(snapshot.rerunSettings.maxVoiceCount),
    );
  }

  function handleDiffTargetChange(nextTargetId: string) {
    setDiffTargetId(nextTargetId);
    setShowChangedNotes(false);
    setOnlyChangedNotes(false);
    setCompareState(null);
  }

  function handleStartCompare() {
    if (!diffTargetId) {
      return;
    }
    setCompareState(createCompareState("current", diffTargetId));
    setInteractionMode("select");
    setOnlyChangedNotes(false);
  }

  function handleSetCompareViewing(viewing: CompareViewing) {
    setCompareState((current) => updateCompareViewing(current, viewing));
    if (viewing === "B" || viewing === "diff") {
      setInteractionMode("select");
      setSelectedNoteIds(new Set());
    }
  }

  function handleExitCompare() {
    setCompareState(null);
  }

  function handleRestoreCompareTarget() {
    const target = namedSnapshots.find(
      (snapshot) => snapshot.id === compareState?.targetSnapshotId,
    );
    if (target) {
      handleRestoreSnapshot(target);
      setCompareState(null);
    }
  }

  function handleCreateVoice() {
    pushHistorySnapshot();
    const newVoiceId = nextVoiceId(voiceOrder);
    setVoiceOrder((currentOrder) => [...currentOrder, newVoiceId]);

    if (selectedNoteIds.size > 0) {
      setVoiceOverrides((currentOverrides) => {
        const nextOverrides = { ...currentOverrides };
        for (const noteId of selectedNoteIds) {
          nextOverrides[noteId] = newVoiceId;
        }
        return nextOverrides;
      });
      setRangeAssignedNoteIds((current) => {
        const next = new Set(current);
        for (const noteId of selectedNoteIds) {
          next.delete(noteId);
        }
        return next;
      });
    }

    setExportResult(null);
  }

  function handleRenameVoice(voiceId: string, label: string) {
    setVoiceLabels((currentLabels) => ({ ...currentLabels, [voiceId]: label }));
  }

  function handleMergeVoice(fromVoiceId: string, toVoiceId: string) {
    if (!displayedProject || fromVoiceId === toVoiceId || toVoiceId === "") {
      return;
    }

    pushHistorySnapshot();
    const patch = mergeVoiceOverrides(displayedProject.notes, fromVoiceId, toVoiceId);
    setVoiceOverrides((currentOverrides) => ({ ...currentOverrides, ...patch }));
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of Object.keys(patch)) {
        next.delete(noteId);
      }
      return next;
    });
    setVoiceOrder((currentOrder) => currentOrder.filter((voiceId) => voiceId !== fromVoiceId));
    setActiveVoiceId((current) => (current === fromVoiceId ? null : current));
    setSoloVoiceId((current) => (current === fromVoiceId ? null : current));
    setExportResult(null);
  }

  function handleReorderVoice(voiceId: string, direction: -1 | 1) {
    pushHistorySnapshot();
    setVoiceOrder((currentOrder) => {
      const index = currentOrder.indexOf(voiceId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= currentOrder.length) {
        return currentOrder;
      }
      const nextOrder = [...currentOrder];
      [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
      return nextOrder;
    });
  }

  function handleToggleSolo(voiceId: string) {
    setSoloVoiceId((current) => (current === voiceId ? null : voiceId));
  }

  function applyNoteReassignment(noteIds: string[], voiceId: string) {
    pushHistorySnapshot();
    setVoiceOverrides((currentOverrides) => {
      const nextOverrides = { ...currentOverrides };
      for (const noteId of noteIds) {
        nextOverrides[noteId] = voiceId;
      }
      return nextOverrides;
    });
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of noteIds) {
        next.delete(noteId);
      }
      return next;
    });
    setExportResult(null);
  }

  function handlePaintNotes(noteIds: string[]) {
    if (!activeVoiceId) {
      return;
    }
    applyNoteReassignment(noteIds, activeVoiceId);
  }

  /** Context-menu "Assign to" — same reassignment path, explicit voice. */
  function handleAssignNotesToVoice(noteIds: string[], voiceId: string) {
    if (noteIds.length === 0) {
      return;
    }
    applyNoteReassignment(noteIds, voiceId);
  }

  function handleMarkerPitchChange(markerId: string, pitch: number) {
    if (!Number.isFinite(pitch)) {
      return;
    }

    setPitchMarkers((currentMarkers) =>
      currentMarkers.map((marker) =>
        marker.id === markerId ? { ...marker, pitch: clampMidiPitch(pitch) } : marker,
      ),
    );
  }

  function handleApplyPitchRanges() {
    if (!displayedProject || voiceRangeRules.length === 0) {
      return;
    }

    const rangePatch = buildVoiceOverridesFromRangeRules(
      displayedProject.notes,
      pitchMarkers,
      voiceRangeRules,
    );
    if (Object.keys(rangePatch).length === 0) {
      return;
    }

    const { overrides, rangeAssignedNoteIds: nextRangeAssignedNoteIds } =
      applyRangePatchPreservingHandCorrections(voiceOverrides, rangeAssignedNoteIds, rangePatch);

    pushHistorySnapshot();
    setVoiceOverrides(overrides);
    setRangeAssignedNoteIds(nextRangeAssignedNoteIds);
    setSelectedNoteIds(new Set(Object.keys(rangePatch)));
    setExportResult(null);
  }

  function handleSplitVoiceByPitch(voiceId: string) {
    if (!displayedProject) {
      return;
    }

    const repair = buildSplitVoiceByPitchRepair(displayedProject.notes, voiceOrder, voiceId);
    if (!repair) {
      return;
    }

    const sourceLabel =
      displayedProject.voices.find((voice) => voice.id === voiceId)?.label ?? voiceId;
    pushHistorySnapshot();
    setVoiceOverrides((currentOverrides) => ({ ...currentOverrides, ...repair.overrides }));
    setVoiceOrder(repair.voiceOrder);
    setVoiceLabels((currentLabels) => ({
      ...currentLabels,
      [repair.newVoiceId]: `${sourceLabel} high`,
    }));
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of repair.movedNoteIds) {
        next.delete(noteId);
      }
      return next;
    });
    setSelectedNoteIds(new Set(repair.movedNoteIds));
    setActiveVoiceId(repair.newVoiceId);
    setExportResult(null);
  }

  function handleSplitAllWidePitchVoices() {
    if (!displayedProject || pitchSplitVoiceIds.length === 0) {
      return;
    }

    const repair = buildSplitAllWidePitchRepair(
      displayedProject.notes,
      voiceOrder,
      pitchSplitVoiceIds,
    );
    if (!repair) {
      return;
    }

    const sourceLabels = new Map(displayedProject.voices.map((voice) => [voice.id, voice.label]));
    pushHistorySnapshot();
    setVoiceOverrides((currentOverrides) => ({ ...currentOverrides, ...repair.overrides }));
    setVoiceOrder(repair.voiceOrder);
    setVoiceLabels((currentLabels) => {
      const nextLabels = { ...currentLabels };
      for (const item of repair.repairs) {
        const sourceLabel = sourceLabels.get(item.sourceVoiceId) ?? item.sourceVoiceId;
        nextLabels[item.newVoiceId] = `${sourceLabel} high`;
      }
      return nextLabels;
    });
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of repair.movedNoteIds) {
        next.delete(noteId);
      }
      return next;
    });
    setSelectedNoteIds(new Set(repair.movedNoteIds));
    setActiveVoiceId(repair.repairs[0]?.newVoiceId ?? null);
    setExportResult(null);
  }
  function handleSplitAllMixedChannels() {
    if (!displayedProject || channelSplitVoiceIds.length === 0) {
      return;
    }

    const repair = buildSplitAllMixedChannelsRepair(
      displayedProject.notes,
      voiceOrder,
      channelSplitVoiceIds,
    );
    if (!repair) {
      return;
    }

    const sourceLabels = new Map(displayedProject.voices.map((voice) => [voice.id, voice.label]));
    pushHistorySnapshot();
    setVoiceOverrides((currentOverrides) => ({ ...currentOverrides, ...repair.overrides }));
    setVoiceOrder(repair.voiceOrder);
    setVoiceLabels((currentLabels) => {
      const nextLabels = { ...currentLabels };
      for (const item of repair.repairs) {
        const sourceLabel = sourceLabels.get(item.sourceVoiceId) ?? item.sourceVoiceId;
        nextLabels[item.newVoiceId] = `${sourceLabel} ${formatMidiChannel(item.movedChannel)}`;
      }
      return nextLabels;
    });
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of repair.movedNoteIds) {
        next.delete(noteId);
      }
      return next;
    });
    setSelectedNoteIds(new Set(repair.movedNoteIds));
    setActiveVoiceId(repair.repairs[0]?.newVoiceId ?? null);
    setExportResult(null);
  }
  function handleSplitVoiceByChannel(voiceId: string) {
    if (!displayedProject) {
      return;
    }

    const repair = buildSplitVoiceByChannelRepair(displayedProject.notes, voiceOrder, voiceId);
    if (!repair) {
      return;
    }

    const sourceLabel =
      displayedProject.voices.find((voice) => voice.id === voiceId)?.label ?? voiceId;
    pushHistorySnapshot();
    setVoiceOverrides((currentOverrides) => ({ ...currentOverrides, ...repair.overrides }));
    setVoiceOrder(repair.voiceOrder);
    setVoiceLabels((currentLabels) => ({
      ...currentLabels,
      [repair.newVoiceId]: `${sourceLabel} ${formatMidiChannel(repair.movedChannel)}`,
    }));
    setRangeAssignedNoteIds((current) => {
      const next = new Set(current);
      for (const noteId of repair.movedNoteIds) {
        next.delete(noteId);
      }
      return next;
    });
    setSelectedNoteIds(new Set(repair.movedNoteIds));
    setActiveVoiceId(repair.newVoiceId);
    setExportResult(null);
  }
  function handleTogglePaintMode() {
    setPianoRollViewMode("piano");
    setInteractionMode((mode) => (mode === "paint" ? "select" : "paint"));
  }

  function handleToggleRangeMode() {
    setPianoRollViewMode("piano");
    setInteractionMode((mode) => (mode === "range" ? "select" : "range"));
  }

  function handleAcceptCurrentReviewNote() {
    if (!currentFlaggedNote) {
      return;
    }
    pushHistorySnapshot();
    const decision = applyReviewDecision(
      voiceOverrides,
      rangeAssignedNoteIds,
      currentFlaggedNote.id,
      currentFlaggedNote.voiceId,
    );
    setVoiceOverrides(decision.voiceOverrides);
    setRangeAssignedNoteIds(decision.rangeAssignedNoteIds);
    setSkippedReviewNoteIds((current) => {
      const next = new Set(current);
      next.delete(currentFlaggedNote.id);
      return next;
    });
    setExportResult(null);
  }

  function handleAssignCurrentReviewNote(voiceId: string) {
    if (!currentFlaggedNote || voiceId === "") {
      return;
    }
    pushHistorySnapshot();
    const decision = applyReviewDecision(
      voiceOverrides,
      rangeAssignedNoteIds,
      currentFlaggedNote.id,
      voiceId,
    );
    setVoiceOverrides(decision.voiceOverrides);
    setRangeAssignedNoteIds(decision.rangeAssignedNoteIds);
    setSkippedReviewNoteIds((current) => {
      const next = new Set(current);
      next.delete(currentFlaggedNote.id);
      return next;
    });
    setSelectedNoteIds(new Set([currentFlaggedNote.id]));
    setExportResult(null);
  }

  function handleSkipCurrentReviewNote() {
    if (!currentFlaggedNote) {
      return;
    }
    setSkippedReviewNoteIds((current) => new Set(current).add(currentFlaggedNote.id));
  }
  function handleReviewStep(direction: 1 | -1) {
    const currentStartTick = selectedNote ? selectedNote.startTick : null;
    const nextId = findNextFlaggedNoteId(flaggedNotes, currentStartTick, direction);
    if (nextId) {
      setSelectedNoteIds(new Set([nextId]));
    }
  }

  function handleInspectDiagnosticVoice(voiceId: string) {
    if (!displayedProject) {
      return;
    }

    setActiveVoiceId(voiceId);
    setSoloVoiceId(voiceId);
    setSelectedNoteIds(new Set(noteIdsForVoice(displayedProject.notes, voiceId)));
  }

  function handleInspectDiagnosticNoteIds(voiceId: string, noteIds: readonly string[]) {
    setActiveVoiceId(voiceId);
    setSoloVoiceId(voiceId);
    setSelectedNoteIds(new Set(noteIds));
  }
  function handleSelectVoiceSwatch(voiceId: string) {
    setActiveVoiceId((current) => (current === voiceId ? null : voiceId));
    if (!displayedProject) {
      return;
    }
    setSelectedNoteIds(new Set(noteIdsForVoice(displayedProject.notes, voiceId)));
  }

  return (
    <main className="app-shell">
      {isDragOver ? (
        <div className="drop-overlay" role="status" aria-live="polite">
          <p>Drop to import MIDI file</p>
        </div>
      ) : null}
      <header className="app-header">
        <div>
          <h1>Chiptune Voice Separator</h1>
          <p>{status}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleUndo}
            disabled={history.past.length === 0 || isReassigning || isCompareReadOnly}
          >
            Undo
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleRedo}
            disabled={history.future.length === 0 || isReassigning || isCompareReadOnly}
          >
            Redo
          </button>
          <MidiImportButton
            disabled={isImporting || isExporting || isReassigning || isCompareReadOnly}
            onImport={() => void handleImport()}
          />
          <MidiExportButton
            disabled={
              !displayedProject || isImporting || isExporting || isReassigning || isCompareReadOnly
            }
            onExport={() => void handleExport()}
          />
        </div>
      </header>

      <section className="summary-bar" aria-live="polite">
        {isImporting ? (
          <span>Importing MIDI...</span>
        ) : isExporting ? (
          <span>Exporting corrected MIDI...</span>
        ) : project ? (
          <span>Loaded {project.fileName}</span>
        ) : (
          <span>Select a Standard MIDI File to inspect its notes.</span>
        )}
      </section>

      {error ? (
        <section className="inline-error" role="alert">
          <strong>{error.code}</strong>
          <span>{error.message}</span>
        </section>
      ) : null}

      {exportError ? (
        <section className="inline-error" role="alert">
          <strong>{exportError.code}</strong>
          <span>{exportError.message}</span>
        </section>
      ) : null}

      {reassignError ? (
        <section className="inline-error" role="alert">
          <strong>{reassignError.code}</strong>
          <span>{reassignError.message}</span>
        </section>
      ) : null}

      {exportResult ? (
        <section className="export-success" aria-live="polite">
          Exported {exportResult.noteCount} notes across {exportResult.trackCount} tracks to{" "}
          {exportResult.path}.
        </section>
      ) : null}

      {displayedProject ? (
        <section
          className={`export-readiness export-readiness-${exportReadinessSummary.status}`}
          aria-label="Export readiness summary"
        >
          <div className="export-readiness-header">
            <h2>Export readiness</h2>
            <p>{formatExportReadinessStatus(exportReadinessSummary)}</p>
          </div>
          <ul className="export-readiness-list">
            {exportReadinessSummary.findings.map((finding) => (
              <li key={finding.id} className={`export-readiness-item ${finding.severity}`}>
                <span className="export-readiness-label">{finding.label}</span>
                <span>{finding.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {displayedProject ? (
        <section className="separation-summary" aria-live="polite">
          <span>
            {isReassigning
              ? "Re-running separation..."
              : formatSeparationSummary(
                  displayedProject.separationSummary,
                  displayedProject.notes.length,
                )}
          </span>
          <div className="separation-summary-actions">
            {flaggedNotes.length > 0 ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleReviewStep(1)}
                disabled={isReassigning || isCompareReadOnly}
              >
                Review flagged notes ({flaggedNotes.length})
              </button>
            ) : null}
            <label className="max-voice-count-label">
              Max voices
              <input
                type="number"
                className="max-voice-count-input"
                min={1}
                placeholder="auto"
                value={maxVoiceCountInput}
                onChange={(event) => setMaxVoiceCountInput(event.target.value)}
                aria-label="Maximum voice count for re-run separation"
              />
            </label>
            <label className="separation-strategy-label">
              Strategy
              <select
                className="separation-strategy-select"
                value={separationStrategy}
                onChange={(event) =>
                  setSeparationStrategy(event.target.value as SeparationStrategy)
                }
                aria-label="Separation strategy for re-run separation"
              >
                <option value="BALANCED">Balanced</option>
                <option value="CHANNEL_PRIORITY">Channel priority</option>
                <option value="REGISTER_PRIORITY">Register priority</option>
                <option value="STRICT_CHANNEL">Strict channel</option>
              </select>
            </label>
            <label className="assignment-mode-label">
              Search
              <select
                className="assignment-mode-select"
                value={assignmentMode}
                onChange={(event) => setAssignmentMode(event.target.value as AssignmentMode)}
                aria-label="Assignment search mode for re-run separation"
              >
                <option value="GREEDY">Greedy (fast)</option>
                <option value="GLOBAL">Global (lookahead)</option>
                <option value="CONTIG">Contig (structure)</option>
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleReassign()}
              disabled={isImporting || isExporting || isReassigning || isCompareReadOnly}
            >
              Re-run separation
            </button>
          </div>
          <p className="strategy-suggestion">
            {formatStrategySuggestion(displayedProject.strategySuggestion)}
          </p>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="voice-diagnostics" aria-label="Voice diagnostics">
          <details open={suspiciousVoiceCount > 0}>
            <summary>
              Voice diagnostics: {suspiciousVoiceCount} suspicious of {voiceDiagnostics.length}
            </summary>
            {separationRecommendation ? (
              <p className="voice-diagnostics-recommendation">{separationRecommendation.message}</p>
            ) : null}{" "}
            {channelSplitVoiceIds.length > 1 || pitchSplitVoiceIds.length > 1 ? (
              <div className="voice-diagnostics-toolbar">
                {channelSplitVoiceIds.length > 1 ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleSplitAllMixedChannels}
                    disabled={isReassigning || isCompareReadOnly}
                  >
                    Split all mixed-channel voices ({channelSplitVoiceIds.length})
                  </button>
                ) : null}
                {pitchSplitVoiceIds.length > 1 ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleSplitAllWidePitchVoices}
                    disabled={isReassigning || isCompareReadOnly}
                  >
                    Split all wide voices ({pitchSplitVoiceIds.length})
                  </button>
                ) : null}
              </div>
            ) : null}
            {sortedVoiceDiagnostics.length > 0 ? (
              <ul className="voice-diagnostics-list">
                {sortedVoiceDiagnostics.map((diagnostic) => {
                  const splitPreview = voiceSplitPreviews.get(diagnostic.voiceId);
                  const flaggedNoteIds = flaggedNoteIdsByVoice.get(diagnostic.voiceId) ?? [];
                  return (
                    <li
                      key={diagnostic.voiceId}
                      className={diagnostic.suspicious ? "suspicious" : undefined}
                    >
                      <div>
                        <strong>{formatVoiceDiagnosticSummary(diagnostic)}</strong>
                        <span>
                          {diagnostic.suspiciousReasons.length > 0
                            ? `Reasons: ${diagnostic.suspiciousReasons.join(", ")}`
                            : "No obvious sanity flags."}
                        </span>
                        <span>{formatVoiceChannelDistribution(diagnostic)}</span>
                      </div>
                      <div className="voice-diagnostics-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleInspectDiagnosticVoice(diagnostic.voiceId)}
                          disabled={isCompareReadOnly}
                        >
                          Focus in roll
                        </button>
                        {flaggedNoteIds.length > 0 ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              handleInspectDiagnosticNoteIds(diagnostic.voiceId, flaggedNoteIds)
                            }
                            disabled={isCompareReadOnly}
                          >
                            {formatVoiceFlaggedReviewLabel(flaggedNoteIds)}
                          </button>
                        ) : null}
                        {splitPreview?.channelRepair ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleSplitVoiceByChannel(diagnostic.voiceId)}
                            disabled={isReassigning || isCompareReadOnly}
                          >
                            {formatSplitVoiceByChannelRepairLabel(splitPreview.channelRepair)}
                          </button>
                        ) : null}
                        {splitPreview?.pitchRepair ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleSplitVoiceByPitch(diagnostic.voiceId)}
                            disabled={isReassigning || isCompareReadOnly}
                          >
                            {formatSplitVoiceByPitchRepairLabel(splitPreview.pitchRepair)}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="voice-diagnostics-empty">No voices to diagnose.</p>
            )}
          </details>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="file-details" aria-label="Imported file details">
          <div>
            <span className="detail-label">Format</span>
            <strong>{displayedProject.format}</strong>
          </div>
          <div>
            <span className="detail-label">Suggested voices</span>
            <strong>{displayedProject.voices.length}</strong>
          </div>
          <div>
            <span className="detail-label">Tempo changes</span>
            <strong>{displayedProject.tempoChanges.length}</strong>
          </div>
          <div>
            <span className="detail-label">Time signatures</span>
            <strong>{displayedProject.timeSignatures.length}</strong>
          </div>
          <div>
            <span className="detail-label">Recoverable warnings</span>
            <strong>{displayedProject.warnings.length}</strong>
          </div>
        </section>
      ) : null}

      {displayedProject && displayedProject.warnings.length > 0 ? (
        <section className="warnings" aria-label="Import warnings">
          <details>
            <summary>Recoverable import warnings ({displayedProject.warnings.length})</summary>
            <p>The MIDI file was imported, but the parser repaired or ignored these events.</p>
            <ul className="warning-list">
              {displayedProject.warnings.map((warning, index) => (
                <li
                  key={`${warning.code}-${warning.trackIndex ?? "none"}-${warning.tick ?? "none"}-${index}`}
                >
                  <div className="warning-heading">
                    <span>{warning.code}</span>
                    <span>{formatMidiWarningLocation(warning)}</span>
                  </div>
                  <p>{warning.message}</p>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="voice-legend" aria-label="Voice assignments">
          <h2>Voices</h2>
          <ul>
            {displayedProject.voices.map((voice, index) => (
              <li key={voice.id} className={activeVoiceId === voice.id ? "active" : undefined}>
                <button
                  type="button"
                  className="voice-swatch"
                  disabled={isCompareReadOnly}
                  style={{ backgroundColor: `var(--voice-${(index % 12) + 1})` }}
                  aria-label={`Select notes in ${voice.label}`}
                  onClick={() => handleSelectVoiceSwatch(voice.id)}
                />
                <input
                  className="voice-name-input"
                  disabled={isCompareReadOnly}
                  value={voice.label}
                  onFocus={pushHistorySnapshot}
                  onChange={(event) => handleRenameVoice(voice.id, event.target.value)}
                  aria-label={`Rename ${voice.label}`}
                />
                <span>
                  {voice.noteCount} notes, pitches {voice.lowestPitch}-{voice.highestPitch}
                </span>
                <button
                  type="button"
                  className={soloVoiceId === voice.id ? "voice-solo active" : "voice-solo"}
                  onClick={() => handleToggleSolo(voice.id)}
                  disabled={isCompareReadOnly}
                  aria-pressed={soloVoiceId === voice.id ? "true" : "false"}
                >
                  Solo
                </button>
                <button
                  type="button"
                  className="voice-reorder"
                  onClick={() => handleReorderVoice(voice.id, -1)}
                  disabled={index === 0 || isCompareReadOnly}
                  aria-label={`Move ${voice.label} up`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="voice-reorder"
                  onClick={() => handleReorderVoice(voice.id, 1)}
                  disabled={index === displayedProject.voices.length - 1 || isCompareReadOnly}
                  aria-label={`Move ${voice.label} down`}
                >
                  ▼
                </button>
                <select
                  className="voice-merge-select"
                  disabled={isCompareReadOnly}
                  value=""
                  onChange={(event) => handleMergeVoice(voice.id, event.target.value)}
                  aria-label={`Merge ${voice.label} into another voice`}
                >
                  <option value="">Merge into...</option>
                  {displayedProject.voices
                    .filter((otherVoice) => otherVoice.id !== voice.id)
                    .map((otherVoice) => (
                      <option key={otherVoice.id} value={otherVoice.id}>
                        {otherVoice.label}
                      </option>
                    ))}
                </select>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="secondary-button"
            onClick={handleCreateVoice}
            disabled={isCompareReadOnly}
          >
            + New voice
          </button>
        </section>
      ) : null}

      {displayedProject ? (
        <section className="range-rules" aria-label="Pitch range voice rules">
          <div className="range-rules-header">
            <h2>Pitch ranges</h2>
            <button
              type="button"
              className="secondary-button"
              onClick={handleApplyPitchRanges}
              disabled={voiceRangeRules.length === 0 || isCompareReadOnly}
            >
              Apply ranges
            </button>
          </div>
          <div className="pitch-marker-list">
            {pitchMarkers.map((marker) => (
              <label key={marker.id} className="pitch-marker-control">
                {marker.label}
                <input
                  type="number"
                  disabled={isCompareReadOnly}
                  min={0}
                  max={127}
                  value={marker.pitch}
                  onChange={(event) =>
                    handleMarkerPitchChange(marker.id, Number.parseInt(event.target.value, 10))
                  }
                />
              </label>
            ))}
          </div>
          {voiceRangeRules.length > 0 ? (
            <ul className="range-rule-list">
              {voiceRangeRules.map((rule) => {
                const voiceLabel =
                  displayedProject.voices.find((voice) => voice.id === rule.voiceId)?.label ??
                  rule.voiceId;
                return (
                  <li key={rule.id}>
                    <span>{rule.label}</span>
                    <strong>{voiceLabel}</strong>
                    <span>{describePitchRangeRule(rule, pitchMarkers)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="range-rules-empty">Create at least one voice before applying ranges.</p>
          )}
        </section>
      ) : null}

      {displayedProject ? (
        <section className="editor-snapshots" aria-label="Editor snapshots">
          <div className="editor-snapshots-header">
            <h2>Snapshots</h2>
            <div className="editor-snapshots-save">
              <input
                type="text"
                className="snapshot-name-input"
                placeholder="Snapshot name"
                value={snapshotNameDraft}
                onChange={(event) => setSnapshotNameDraft(event.target.value)}
                aria-label="New snapshot name"
              />
              <button type="button" className="secondary-button" onClick={handleSaveSnapshot}>
                Save snapshot
              </button>
            </div>
          </div>
          <p className="editor-snapshots-hint">
            Restoring a snapshot also restores which notes are locked for re-runs.
          </p>
          {namedSnapshots.length > 0 ? (
            <ul className="snapshot-list">
              {namedSnapshots
                .slice()
                .reverse()
                .map((snapshot) => (
                  <li key={snapshot.id}>
                    <div className="snapshot-meta">
                      <input
                        className="snapshot-name-input"
                        value={snapshot.name}
                        onChange={(event) => handleRenameSnapshot(snapshot.id, event.target.value)}
                        aria-label={`Rename snapshot ${snapshot.name}`}
                      />
                      <span>{formatSnapshotSummary(snapshot)}</span>
                    </div>
                    <div className="snapshot-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleUseSnapshotSettings(snapshot)}
                      >
                        Use these settings
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleRestoreSnapshot(snapshot)}
                        disabled={isReassigning || isCompareReadOnly}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleDeleteSnapshot(snapshot.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="snapshot-list-empty">No snapshots yet.</p>
          )}
        </section>
      ) : null}

      {displayedProject ? (
        <section className="diff-summary" aria-label="Assignment diff summary">
          <div className="diff-summary-header">
            <h2>What changed?</h2>
            <label className="diff-target-label">
              Compare current to
              <select
                className="diff-target-select"
                value={diffTargetId}
                onChange={(event) => handleDiffTargetChange(event.target.value)}
                aria-label="Snapshot to compare the current state against"
              >
                <option value="">No comparison</option>
                {importSnapshot ? (
                  <option value={importSnapshot.id}>
                    Import ({formatSnapshotTimestamp(importSnapshot.createdAt)})
                  </option>
                ) : null}
                {mostRecentSnapshot && mostRecentSnapshot.id !== importSnapshot?.id ? (
                  <option value={mostRecentSnapshot.id}>
                    Most recent snapshot ({formatSnapshotTimestamp(mostRecentSnapshot.createdAt)})
                  </option>
                ) : null}
                {namedSnapshots
                  .filter(
                    (entry) =>
                      entry.id !== importSnapshot?.id && entry.id !== mostRecentSnapshot?.id,
                  )
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {!diffTargetId ? (
            <p className="diff-summary-empty">Choose a snapshot above to see what changed.</p>
          ) : !assignmentDiffResult ? (
            <p className="diff-summary-empty">Nothing to compare yet.</p>
          ) : !assignmentDiffResult.comparable ? (
            <p className="diff-summary-incomparable">{assignmentDiffResult.reason}</p>
          ) : (
            <>
              <dl className="diff-summary-stats">
                <div>
                  <dt>Notes reassigned</dt>
                  <dd>{assignmentDiffResult.changedNoteIds.length}</dd>
                </div>
                <div>
                  <dt>Voices added</dt>
                  <dd>{assignmentDiffResult.addedVoiceIds.length}</dd>
                </div>
                <div>
                  <dt>Voices removed</dt>
                  <dd>{assignmentDiffResult.removedVoiceIds.length}</dd>
                </div>
                <div>
                  <dt>Labels changed</dt>
                  <dd>{assignmentDiffResult.changedVoiceLabels.length}</dd>
                </div>
                <div>
                  <dt>Locks preserved</dt>
                  <dd>{assignmentDiffResult.locksPreservedCount}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{formatConfidenceDelta(assignmentDiffResult)}</dd>
                </div>
              </dl>
              {assignmentDiffResult.percussionDelta ? (
                <p className="diff-summary-note">
                  {formatPercussionDelta(assignmentDiffResult.percussionDelta)}
                </p>
              ) : null}
              {formatOnlyInOneSideSummary(assignmentDiffResult) ? (
                <p className="diff-summary-note">
                  {formatOnlyInOneSideSummary(assignmentDiffResult)}
                </p>
              ) : null}
              <div className="diff-visual-controls" aria-label="Piano-roll change display">
                <label>
                  <input
                    type="checkbox"
                    checked={showChangedNotes}
                    onChange={(event) => {
                      setShowChangedNotes(event.target.checked);
                      if (!event.target.checked) {
                        setOnlyChangedNotes(false);
                      }
                    }}
                    disabled={!canShowChangedNotes}
                  />
                  Show changes in piano roll
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={onlyChangedNotes}
                    onChange={(event) => setOnlyChangedNotes(event.target.checked)}
                    disabled={!canShowChangedNotes || !showChangedNotes}
                  />
                  Only changed notes
                </label>
              </div>
              <div className="compare-controls" aria-label="A/B compare preview controls">
                {compareState ? (
                  <>
                    <div className="compare-view-toggle" role="group" aria-label="Compare view">
                      {(["A", "B", "diff"] as const).map((viewing) => (
                        <button
                          key={viewing}
                          type="button"
                          className={
                            compareState.viewing === viewing
                              ? "secondary-button active"
                              : "secondary-button"
                          }
                          onClick={() => handleSetCompareViewing(viewing)}
                          aria-pressed={compareState.viewing === viewing ? "true" : "false"}
                        >
                          {viewing === "A"
                            ? "A: Current"
                            : viewing === "B"
                              ? "B: Snapshot"
                              : "Diff"}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleRestoreCompareTarget}
                    >
                      Restore B
                    </button>
                    <button type="button" className="secondary-button" onClick={handleExitCompare}>
                      Exit compare
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleStartCompare}
                    disabled={
                      !diffTargetId || !assignmentDiffResult || !assignmentDiffResult.comparable
                    }
                  >
                    Start A/B compare
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      ) : null}

      {displayedProject ? (
        <section className="selection-details" aria-label="Selected note details">
          <h2>Selected note{selectedNotes.length === 1 ? "" : "s"}</h2>
          {selectedNote ? (
            <dl>
              <div>
                <dt>Pitch</dt>
                <dd>{selectedNote.pitch}</dd>
              </div>
              <div>
                <dt>Voice</dt>
                <dd>{selectedNote.voiceId}</dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>{formatMidiChannel(selectedNote.channel)}</dd>
              </div>
              <div>
                <dt>Ticks</dt>
                <dd>
                  {selectedNote.startTick}-{selectedNote.endTick}
                </dd>
              </div>
            </dl>
          ) : selectedNotes.length > 1 ? (
            <p>{formatSelectionSummary(selectedNotes)}</p>
          ) : (
            <p>{formatSelectedNote(null)}</p>
          )}
          <p className="keyboard-hint">
            Click a note, shift-click to add or remove one, or drag a marquee over many. Press{" "}
            <kbd>1</kbd>-<kbd>9</kbd> to assign the selection to an existing voice. Press{" "}
            <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> to step through flagged notes. Press{" "}
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> to undo or
            redo a correction. Press <kbd>Esc</kbd> to clear selection. On the piano roll,{" "}
            <kbd>Ctrl</kbd>+wheel zooms horizontally and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+wheel
            zooms vertically (both anchored at the cursor); plain wheel pans horizontally and{" "}
            <kbd>Shift</kbd>+wheel pans vertically.
          </p>
        </section>
      ) : null}

      {displayedProject && flaggedNotes.length > 0 ? (
        <section className="review-queue-panel" aria-label="Guided flagged-note review">
          <div className="review-queue-header">
            <div>
              <h2>Flagged note review</h2>
              <p>
                {reviewProgress.reviewedCount} of {reviewProgress.flaggedCount} reviewed. Re-run
                updated the flagged list after assignments last changed.
              </p>
            </div>
            <div className="review-queue-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleReviewStep(-1)}
                disabled={isCompareReadOnly}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleReviewStep(1)}
                disabled={isCompareReadOnly}
              >
                Next
              </button>
            </div>
          </div>
          {currentFlaggedNote ? (
            <div className="review-current-note">
              <dl>
                <div>
                  <dt>Pitch</dt>
                  <dd>{currentFlaggedNote.pitch}</dd>
                </div>
                <div>
                  <dt>Voice</dt>
                  <dd>{currentFlaggedNote.voiceId}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{Math.round(currentFlaggedNote.assignmentConfidence * 100)}%</dd>
                </div>
                <div>
                  <dt>Ticks</dt>
                  <dd>
                    {currentFlaggedNote.startTick}-{currentFlaggedNote.endTick}
                  </dd>
                </div>
              </dl>
              <div className="review-current-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleAcceptCurrentReviewNote}
                  disabled={isCompareReadOnly}
                >
                  Accept & lock
                </button>
                <label>
                  Assign to
                  <select
                    className="review-assign-select"
                    value=""
                    onChange={(event) => handleAssignCurrentReviewNote(event.target.value)}
                    disabled={isCompareReadOnly}
                  >
                    <option value="">Choose voice...</option>
                    {displayedProject.voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleSkipCurrentReviewNote}
                  disabled={isCompareReadOnly}
                >
                  Skip
                </button>
              </div>
            </div>
          ) : (
            <p className="review-queue-empty">
              Select a flagged note or use Next to start reviewing.
            </p>
          )}
        </section>
      ) : null}
      {isCompareReadOnly ? (
        <section className="compare-readonly-banner" aria-live="polite">
          Read-only preview: editing is disabled while viewing the snapshot or diff. Exit compare or
          restore B to edit.
        </section>
      ) : null}

      {displayedProject ? (
        <section className="piano-roll-toolbar">
          <button
            type="button"
            className={
              pianoRollViewMode === "piano" ? "secondary-button active" : "secondary-button"
            }
            onClick={() => setPianoRollViewMode("piano")}
            aria-pressed={pianoRollViewMode === "piano" ? "true" : "false"}
          >
            Piano roll
          </button>
          <button
            type="button"
            className={
              pianoRollViewMode === "voice-lanes" ? "secondary-button active" : "secondary-button"
            }
            onClick={() => {
              setPianoRollViewMode("voice-lanes");
              setInteractionMode("select");
            }}
            aria-pressed={pianoRollViewMode === "voice-lanes" ? "true" : "false"}
          >
            Voice lanes
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={playback.isPlaying ? playback.pause : playback.play}
            disabled={isImporting || isExporting || isReassigning || isCompareReadOnly}
          >
            {playback.isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={playback.stop}
            disabled={isImporting || isExporting || isReassigning || isCompareReadOnly}
          >
            Stop
          </button>
          <label className="instrument-label">
            Sound
            <select
              className="instrument-select"
              value={instrument}
              onChange={(event) => setInstrument(event.target.value as Instrument)}
              aria-label="Playback instrument"
            >
              <option value="chiptune">Chiptune</option>
              <option value="piano">Piano</option>
            </select>
          </label>
          <span className="playback-time">
            {formatPlaybackTime(playbackCurrentSeconds)} /{" "}
            {formatPlaybackTime(playbackDurationSeconds)}
          </span>
          <label
            className="playback-scope-label"
            title={
              !canUseChangedPlaybackScope
                ? "Changed notes scope requires a comparable diff with changed notes."
                : !canUseFlaggedPlaybackScope
                  ? "Select a flagged note to enable that scope."
                  : undefined
            }
          >
            Scope
            <select
              className="playback-scope-select"
              value={playbackScopeMode}
              onChange={(event) => setPlaybackScopeMode(event.target.value as PlaybackScopeMode)}
              aria-label="Playback scope"
              disabled={isCompareReadOnly}
            >
              <option value="all">All notes</option>
              <option value="selected">Selected notes</option>
              <option value="voice" disabled={!canUseVoicePlaybackScope}>
                Current voice
              </option>
              <option value="changed" disabled={!canUseChangedPlaybackScope}>
                Changed notes
              </option>
              <option value="flagged" disabled={!canUseFlaggedPlaybackScope}>
                Around flagged note
              </option>
            </select>
          </label>
          {playback.blockedReason ? (
            <span className="playback-scope-message" role="status">
              {playback.blockedReason}
            </span>
          ) : null}
          <button
            type="button"
            className={interactionMode === "paint" ? "secondary-button active" : "secondary-button"}
            onClick={handleTogglePaintMode}
            aria-pressed={interactionMode === "paint" ? "true" : "false"}
            disabled={isCompareReadOnly}
          >
            {interactionMode === "paint" ? "Paint mode: on" : "Paint mode: off"}
          </button>
          {interactionMode === "paint" ? (
            <div className="paint-toolbar">
              <div className="paint-tool-segment" role="group" aria-label="Paint tool">
                <button
                  type="button"
                  className={
                    paintTool === "pencil" ? "paint-tool-button active" : "paint-tool-button"
                  }
                  onClick={() => setPaintTool("pencil")}
                  aria-pressed={paintTool === "pencil" ? "true" : "false"}
                  title="Pencil — paint exactly the note under the cursor (P)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M11.5 2.5l2 2L5 13l-2.7.7.7-2.7z" strokeLinejoin="round" />
                  </svg>
                  <span>Pencil</span>
                </button>
                <button
                  type="button"
                  className={
                    paintTool === "brush" ? "paint-tool-button active" : "paint-tool-button"
                  }
                  onClick={() => setPaintTool("brush")}
                  aria-pressed={paintTool === "brush" ? "true" : "false"}
                  title="Brush — paint every note inside the round brush (B)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path
                      d="M13.5 2.5c-2.2.6-5 3.1-6.5 5.1l1.4 1.4c2-1.5 4.5-4.3 5.1-6.5z"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6.3 8.4c-1.6.1-3 1.6-3 4.1 2.5 0 4-1.4 4.1-3z"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Brush</span>
                </button>
                <button
                  type="button"
                  className={
                    paintTool === "lasso" ? "paint-tool-button active" : "paint-tool-button"
                  }
                  onClick={() => setPaintTool("lasso")}
                  aria-pressed={paintTool === "lasso" ? "true" : "false"}
                  title="Lasso — draw a loop and paint every enclosed note (L)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <ellipse cx="8" cy="6" rx="5.5" ry="3.5" />
                    <path
                      d="M4.5 8.8c-1 1.2-.4 2.8 1 3.2 1.2.3 2.4-.3 2.7-1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>Lasso</span>
                </button>
                <button
                  type="button"
                  className={
                    paintTool === "wand" ? "paint-tool-button active" : "paint-tool-button"
                  }
                  onClick={() => setPaintTool("wand")}
                  aria-pressed={paintTool === "wand" ? "true" : "false"}
                  title="Wand — click a note to paint its whole connected phrase (W)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 13l6.5-6.5" strokeLinecap="round" />
                    <path
                      d="M11.5 1.8v2.4M11.5 6.4v1.4M9.2 4.1h1.4M12.4 4.1h1.9"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>Wand</span>
                </button>
              </div>
              {paintTool === "wand" ? (
                <label
                  className="paint-size-control"
                  title="Max pitch jump (semitones) the wand's phrase fill will cross"
                >
                  Reach
                  <input
                    type="range"
                    min={MIN_WAND_REACH}
                    max={MAX_WAND_REACH}
                    value={wandReach}
                    onChange={(event) => setWandReach(clampWandReach(Number(event.target.value)))}
                    aria-label="Wand reach"
                  />
                  <span className="paint-size-value">{wandReach} st</span>
                </label>
              ) : null}
              {paintTool === "brush" ? (
                <label
                  className="paint-size-control"
                  title="Brush size — also [ and ] keys, or Alt+scroll over the roll"
                >
                  Size
                  <input
                    type="range"
                    min={MIN_BRUSH_RADIUS}
                    max={MAX_BRUSH_RADIUS}
                    value={brushRadius}
                    onChange={(event) =>
                      setBrushRadius(clampBrushRadius(Number(event.target.value)))
                    }
                    aria-label="Brush size"
                  />
                  <span className="paint-size-value">{brushRadius * 2}px</span>
                </label>
              ) : null}
              {activeVoiceId ? (
                <span className="paint-voice-chip" title="The voice this stroke paints into">
                  <span
                    className="paint-voice-chip-swatch"
                    style={{ backgroundColor: getVoiceFillColor(activeVoiceId) }}
                  />
                  {displayedProject.voices.find((voice) => voice.id === activeVoiceId)?.label ??
                    activeVoiceId}
                </span>
              ) : (
                <span className="paint-voice-chip empty">No voice — press 1-9</span>
              )}
            </div>
          ) : null}
          <button
            type="button"
            className={interactionMode === "range" ? "secondary-button active" : "secondary-button"}
            onClick={handleToggleRangeMode}
            aria-pressed={interactionMode === "range" ? "true" : "false"}
            disabled={isCompareReadOnly}
          >
            {interactionMode === "range" ? "Range markers: on" : "Range markers: off"}
          </button>
          {interactionMode === "paint" ? (
            <span className="piano-roll-toolbar-hint">
              {(() => {
                if (!activeVoiceId) {
                  return "Click a voice swatch above or press 1-9 to choose what to paint.";
                }
                const voiceLabel =
                  displayedProject.voices.find((voice) => voice.id === activeVoiceId)?.label ??
                  activeVoiceId;
                if (paintTool === "brush") {
                  return `Drag the brush to paint notes into ${voiceLabel} — hold Alt to remove from the stroke.`;
                }
                if (paintTool === "lasso") {
                  return `Draw a loop around notes to paint notes into ${voiceLabel}.`;
                }
                if (paintTool === "wand") {
                  return `Click a note to paint its connected phrase into ${voiceLabel} — Reach sets the max pitch jump.`;
                }
                return `Click or drag to paint notes into ${voiceLabel}.`;
              })()}
            </span>
          ) : interactionMode === "range" ? (
            <span className="piano-roll-toolbar-hint">
              Drag marker handles in the left piano-roll gutter, then apply the pitch ranges.
            </span>
          ) : null}
        </section>
      ) : null}

      <section className="editor-grid">
        <PianoRoll
          project={pianoRollProject}
          selectedNoteIds={selectedNoteIds}
          onSelectionChange={isCompareReadOnly ? () => {} : setSelectedNoteIds}
          soloVoiceId={pianoRollSoloVoiceId}
          interactionMode={interactionMode}
          activeVoiceId={activeVoiceId}
          onPaintNotes={handlePaintNotes}
          paintTool={paintTool}
          brushRadius={brushRadius}
          onBrushRadiusChange={setBrushRadius}
          wandReach={wandReach}
          onAssignNotes={handleAssignNotesToVoice}
          pitchMarkers={pitchMarkers}
          onPitchMarkersChange={setPitchMarkers}
          currentPlaybackTick={playback.currentTick}
          isPlaying={playback.isPlaying}
          onSeek={playback.seek}
          changedNoteIds={pianoRollChangedNoteIds}
          previousVoiceId={changedNotePreviousVoiceId}
          onlyChangedNotes={pianoRollOnlyChangedNotes}
          readOnly={isCompareReadOnly}
          voiceDescriptions={pianoRollVoiceDescriptions}
          viewMode={pianoRollViewMode}
        />
      </section>

      <footer className="metrics-bar">{formatProjectSummary(displayedProject)}</footer>
    </main>
  );
}
