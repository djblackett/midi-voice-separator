import { useEffect, useMemo, useRef, useState } from "react";
import type { MidiNote, MidiProject } from "../domain/midi/midiProject";
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
import { voiceIdForNumber } from "../domain/midi/voiceAssignments";
import { materializeEditorProject } from "../domain/midi/editorMaterialization";
import { seedVoiceLabelsFromImport } from "../domain/midi/voiceManagement";
import { reconcileVoicesAfterReassign } from "../domain/midi/voiceReconciliation";
import {
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
  conflictNoteIds,
  findNextConflict,
  findVoiceConflicts,
} from "../domain/midi/voiceConflicts";
import {
  buildDefaultPitchMarkers,
  buildDefaultVoiceRangeRules,
  buildVoiceOverridesFromRangeRules,
  clampMidiPitch,
  describePitchRangeRule,
  type PitchMarker,
} from "../domain/midi/rangeRules";
import type { EditorDocument } from "./editor/editorDocument";
import { canApplyRerunResult } from "./editor/rerunGuard";
import { resolveComparisonProjection, type SideProjection } from "./editor/comparisonProjection";
import { resolveKeyboardCommand, type KeyboardCommandId } from "./keyboard/keyboardCommands";
import { useComparisonEditor } from "./editor/useComparisonEditor";
import { defaultViewportWindow, type ViewportWindow } from "../features/piano-roll/viewportWindow";
import {
  defaultPitchViewportWindow,
  type PitchViewportWindow,
} from "../features/piano-roll/pitchViewportWindow";
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
  createComparisonWorkspace,
  isEditingDisabledForComparison,
  materializeSnapshotProject,
  updateComparisonViewing,
  type ComparisonWorkspace,
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
import {
  buildSmartFixSuggestions,
  formatSmartFixActionDetail,
  type SmartFixSuggestion,
} from "../domain/midi/smartFixSuggestions";
import { formatPlaybackTime } from "../features/playback/formatPlaybackTime";
import type { Instrument } from "../features/playback/playbackEngine";
import { usePlaybackEngine } from "../features/playback/usePlaybackEngine";
import type { PlaybackScope } from "../features/playback/scheduledNotes";
import { AssignmentMetricPanel } from "../features/assignment-metric/AssignmentMetricPanel";
import { useAssignmentMetricComparison } from "../features/assignment-metric/useAssignmentMetricComparison";

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
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [soloVoiceId, setSoloVoiceId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("select");
  const [paintTool, setPaintTool] = useState<PaintTool>("brush");
  const [brushRadius, setBrushRadius] = useState(DEFAULT_BRUSH_RADIUS);
  const [wandReach, setWandReach] = useState(DEFAULT_WAND_REACH);
  const [isAuditionEnabled, setIsAuditionEnabled] = useState(true);
  const [isConfidenceHeatOn, setIsConfidenceHeatOn] = useState(false);
  const [pianoRollViewMode, setPianoRollViewMode] = useState<PianoRollViewMode>("piano");
  const [pitchMarkers, setPitchMarkers] = useState<PitchMarker[]>([]);
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
  const [compareState, setCompareState] = useState<ComparisonWorkspace | null>(null);
  const [pendingCompareExit, setPendingCompareExit] = useState(false);
  // Split panes share one time viewport so they stay aligned in musical time.
  // Pitch scroll is independent by default; `linkPitchScroll` shares it too.
  const [splitTimeViewport, setSplitTimeViewport] = useState<ViewportWindow>(defaultViewportWindow);
  const [splitPitchViewport, setSplitPitchViewport] = useState<PitchViewportWindow>(
    defaultPitchViewportWindow,
  );
  const [linkPitchScroll, setLinkPitchScroll] = useState(false);
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false);
  const {
    branch: editorBranch,
    document: editorDocument,
    activeSide: editorActiveSide,
    branchA: editorBranchA,
    branchB: editorBranchB,
    dispatch: dispatchEditorCommand,
    undo: undoEditorBranch,
    redo: redoEditorBranch,
    reset: resetEditorBranch,
    forkB: forkEditorSideB,
    discardB: discardEditorSideB,
    setActiveSide: setEditorActiveSide,
    currentRevision: currentEditorRevision,
  } = useComparisonEditor();
  const rerunRequestSequence = useRef(0);
  const latestRerunRequestId = useRef(0);
  const { project, voiceOverrides, voiceOrder, voiceLabels, rangeAssignedNoteIds } = editorDocument;
  const history = editorBranch.history;
  const displayedProject = useMemo(
    () => materializeEditorProject({ project, voiceOverrides, voiceOrder, voiceLabels }),
    [project, voiceOverrides, voiceOrder, voiceLabels],
  );
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
  const voiceConflicts = useMemo(
    () => (displayedProject ? findVoiceConflicts(displayedProject.notes) : []),
    [displayedProject],
  );
  const pianoRollConflictNoteIds = useMemo(() => conflictNoteIds(voiceConflicts), [voiceConflicts]);
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
  const importSnapshot = namedSnapshots.find((entry) => entry.source === "import");
  const mostRecentSnapshot =
    namedSnapshots.length > 0 ? namedSnapshots[namedSnapshots.length - 1] : undefined;
  const diffTarget = namedSnapshots.find((entry) => entry.id === diffTargetId) ?? null;
  // The diff's reference ("before") side. While a comparison is open it is the
  // live B branch -- so editing B is reflected in the diff -- rather than the
  // frozen snapshot B was forked from. Outside a comparison it is the selected
  // diff-target snapshot. Both expose the same materializable/provenance shape.
  const diffReference = useMemo(() => {
    if (compareState && editorBranchB) {
      return {
        state: editorBranchB.present,
        assignmentProvenance: editorBranchB.present.assignmentProvenance,
      };
    }
    if (diffTarget) {
      return { state: diffTarget.state, assignmentProvenance: diffTarget.assignmentProvenance };
    }
    return null;
  }, [compareState, editorBranchB, diffTarget]);
  const assignmentMetricTargetProject = useMemo(
    () =>
      compareState && editorBranchB
        ? materializeEditorProject(editorBranchB.present)
        : materializeSnapshotProject(diffTarget),
    [compareState, editorBranchB, diffTarget],
  );
  const assignmentMetric = useAssignmentMetricComparison(
    assignmentMetricTargetProject,
    displayedProject,
  );
  // Diffs the reference ("before") side against the live current state
  // ("after"), never a raw project or override map alone (C6) -- toDiffSide
  // reconstructs the same displayed composition App.tsx itself renders.
  const assignmentDiffResult = useMemo(() => {
    if (!diffReference) {
      return null;
    }
    const targetSide = toDiffSide(diffReference.state, diffReference.assignmentProvenance);
    const currentSide = toDiffSide(
      { project, voiceOverrides, voiceOrder, voiceLabels },
      editorDocument.assignmentProvenance,
    );
    if (!targetSide || !currentSide) {
      return null;
    }
    return diffAssignments(targetSide, currentSide);
  }, [diffReference, project, voiceOverrides, voiceOrder, voiceLabels, editorDocument]);
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
  const smartFixSuggestions = useMemo(
    () =>
      displayedProject
        ? buildSmartFixSuggestions({
            notes: displayedProject.notes,
            voices: displayedProject.voices,
            lockedNoteIds: new Set(Object.keys(voiceOverrides)),
          })
        : [],
    [displayedProject, voiceOverrides],
  );
  // The reference ("before") side's own materialized assignments -- its
  // noteId -> voiceId map, reused directly as the changed-note overlay's
  // "previous voice" lookup rather than recomputing it from the diff result.
  const changedNotePreviousVoiceId = useMemo(() => {
    if (!diffReference) {
      return new Map<string, string>();
    }
    const targetSide = toDiffSide(diffReference.state, diffReference.assignmentProvenance);
    return targetSide?.assignments ?? new Map<string, string>();
  }, [diffReference]);
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
  const isCompareReadOnly = isEditingDisabledForComparison(compareState, editorActiveSide);
  // Side B is "dirty" once it has been edited past its fork; its history is
  // empty at fork and gains an entry per committed edit (undoing back to the
  // fork empties it again).
  const isSideBDirty = editorBranchB !== null && editorBranchB.history.past.length > 0;
  // The one workspace projection (M11): it decides what renders, what edits,
  // and how each side's voices map to presentation. In single layout it yields
  // one visible side; in split it yields both, with correspondence-derived
  // presentation keys so a matched B voice takes its A partner's color.
  const comparisonProjection = useMemo(
    () =>
      resolveComparisonProjection(
        { activeSide: editorActiveSide, A: editorBranchA, B: editorBranchB },
        compareState,
      ),
    [editorActiveSide, editorBranchA, editorBranchB, compareState],
  );
  const isSplitLayout = comparisonProjection.visibleSides.length === 2;
  // The canvas always renders the active side's own materialized document:
  // switching the A/B toggle switches the active branch, so `displayedProject`
  // already is the viewed side.
  const pianoRollProject = displayedProject;
  const pianoRollSoloVoiceId = soloVoiceId;
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
  // Cross-side "matches voice X" / "new in preview" descriptions came from the
  // read-only B preview's voice matching. With B now a live editable branch,
  // rich correspondence-based labels move to the split-screen feature (M9/M10).
  const pianoRollVoiceDescriptions = useMemo(() => new Map<string, string>(), []);
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
    // Command implementations. The registry (`resolveKeyboardCommand`) has
    // already applied the focus guard and the project/editable permission
    // gates; each case only re-checks the finer, command-specific applicability
    // (a flagged note exists, paint mode is active, a selection is present),
    // no-oping and skipping preventDefault when unmet -- as the handlers did
    // before the registry.
    function runKeyboardCommand(command: KeyboardCommandId, event: KeyboardEvent) {
      switch (command) {
        case "undo":
          event.preventDefault();
          handleUndo();
          return;
        case "redo":
          event.preventDefault();
          handleRedo();
          return;
        case "clearSelectionOrExitPaint":
          if (interactionMode === "paint") {
            setInteractionMode("select");
          } else {
            setSelectedNoteIds(new Set());
          }
          return;
        case "stepFlaggedForward":
        case "stepFlaggedBackward": {
          if (flaggedNotes.length === 0) {
            return;
          }
          event.preventDefault();
          const currentStartTick = selectedNote ? selectedNote.startTick : null;
          const nextId = findNextFlaggedNoteId(
            flaggedNotes,
            currentStartTick,
            command === "stepFlaggedBackward" ? -1 : 1,
          );
          if (nextId) {
            setSelectedNoteIds(new Set([nextId]));
          }
          return;
        }
        case "toolPencil":
        case "toolBrush":
        case "toolLasso":
        case "toolWand": {
          event.preventDefault();
          const tool: PaintTool =
            command === "toolPencil"
              ? "pencil"
              : command === "toolBrush"
                ? "brush"
                : command === "toolLasso"
                  ? "lasso"
                  : "wand";
          if (interactionMode === "paint" && paintTool === tool) {
            setInteractionMode("select");
          } else {
            setPaintTool(tool);
            setInteractionMode("paint");
          }
          return;
        }
        case "brushSmaller":
        case "brushLarger": {
          if (interactionMode !== "paint" || paintTool !== "brush") {
            return;
          }
          event.preventDefault();
          setBrushRadius((radius) => stepBrushRadius(radius, command === "brushLarger" ? 1 : -1));
          return;
        }
        case "toggleConfidenceHeat":
          event.preventDefault();
          setIsConfidenceHeatOn((current) => !current);
          return;
        case "activateSideA":
        case "activateSideB": {
          event.preventDefault();
          const side = command === "activateSideA" ? "A" : "B";
          // In split both panes are on screen, so just move the active side; in
          // single view, switch which side the one canvas shows and edits.
          if (isSplitLayout) {
            handleActivateSide(side);
          } else {
            handleSetCompareViewing(side);
          }
          return;
        }
        default: {
          // assignVoice1-9
          const voiceNumber = Number(command.slice("assignVoice".length));
          if (!displayedProject) {
            return;
          }
          const targetVoiceId = voiceIdForNumber(displayedProject, voiceNumber);
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
          dispatchEditorCommand({
            kind: "assignNotes",
            noteIds: Array.from(selectedNoteIds),
            voiceId: targetVoiceId,
          });
          setExportResult(null);
        }
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const focusInEditableField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const command = resolveKeyboardCommand(event, {
        focusInEditableField,
        hasProject: displayedProject !== null,
        activeSideEditable: !isCompareReadOnly,
        busy: isReassigning,
        comparisonOpen: compareState !== null,
      });
      if (command) {
        runKeyboardCommand(command, event);
      }
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
    isReassigning,
    compareState,
    isSplitLayout,
    dispatchEditorCommand,
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

  function applyImportedProject(
    importedProject: MidiProject,
    assignmentProvenance: EditorDocument["assignmentProvenance"],
  ) {
    const importVoiceOrder = importedProject.voices.map((voice) => voice.id);
    const importVoiceLabels = seedVoiceLabelsFromImport(importedProject.voices);

    resetEditorBranch({
      documentId: "A",
      revision: 0,
      project: importedProject,
      voiceOverrides: {},
      voiceOrder: importVoiceOrder,
      voiceLabels: importVoiceLabels,
      rangeAssignedNoteIds: new Set(),
      assignmentProvenance,
    });
    setSelectedNoteIds(new Set());
    setSkippedReviewNoteIds(new Set());
    setSeparationStrategy(importedProject.strategySuggestion.strategy);
    setActiveVoiceId(null);
    setSoloVoiceId(null);
    setInteractionMode("select");
    setPitchMarkers(buildDefaultPitchMarkers(importedProject.notes));
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
        undefined,
        undefined,
        assignmentProvenance,
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
      const imported = await selectAndImportMidi();
      if (imported) {
        applyImportedProject(imported.project, imported.provenance);
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
      const imported = await importMidi(path);
      applyImportedProject(imported.project, imported.provenance);
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
    const rerunRequest = {
      branchId: editorBranch.branchId,
      revision: editorDocument.revision,
      requestId: ++rerunRequestSequence.current,
    };
    latestRerunRequestId.current = rerunRequest.requestId;

    setIsReassigning(true);
    setReassignError(null);

    try {
      const reassigned = await reassignVoices(
        project,
        voiceOverrides,
        maxVoiceCount,
        separationStrategy,
        assignmentMode,
      );
      if (
        !canApplyRerunResult(rerunRequest, {
          ...currentEditorRevision(),
          requestId: latestRerunRequestId.current,
        })
      ) {
        setReassignError({
          code: "STALE_RERUN_DROPPED",
          message: "Your edit during rerun was kept; rerun result dropped — rerun again.",
        });
        return;
      }
      const reassignedProject = reassigned.project;
      const rerunSettings: RerunSettings = {
        strategy: separationStrategy,
        assignmentMode,
        maxVoiceCount: maxVoiceCount ?? null,
      };
      // A failed reassignVoices call above throws before any undo or
      // automatic snapshot is recorded, keeping this one whole command
      // transaction atomic from the editor's perspective.
      setNamedSnapshots((current) =>
        appendSnapshot(
          current,
          createNamedSnapshot(
            {
              project,
              voiceOverrides,
              voiceOrder: [...voiceOrder],
              voiceLabels,
              rangeAssignedNoteIds,
            },
            rerunSettings,
            "before-rerun",
            undefined,
            undefined,
            editorDocument.assignmentProvenance,
          ),
        ),
      );
      // Reconcile voice order, labels, and the active/solo voice through voice
      // correspondence (M9): a full re-run reallocates ids for the same
      // grouping, so metadata follows the voices it belongs to instead of being
      // orphaned by raw id.
      const reconciled = reconcileVoicesAfterReassign(
        {
          voiceIds: displayedProject?.voices.map((voice) => voice.id) ?? [],
          assignments: new Map(
            (displayedProject?.notes ?? []).map((note) => [note.id, note.voiceId]),
          ),
        },
        {
          voiceIds: [...new Set(reassignedProject.notes.map((note) => note.voiceId))],
          assignments: new Map(reassignedProject.notes.map((note) => [note.id, note.voiceId])),
        },
        voiceOrder,
        voiceLabels,
      );
      dispatchEditorCommand({
        kind: "replaceProject",
        project: reassignedProject,
        provenance: reassigned.provenance,
        voiceOrder: reconciled.voiceOrder,
        voiceLabels: reconciled.voiceLabels,
      });
      setActiveVoiceId((current) => (current ? (reconciled.oldToNew.get(current) ?? null) : null));
      setSoloVoiceId((current) => (current ? (reconciled.oldToNew.get(current) ?? null) : null));
      setSkippedReviewNoteIds(new Set());
      setNamedSnapshots((current) =>
        appendSnapshot(
          current,
          createNamedSnapshot(
            {
              project: reassignedProject,
              voiceOverrides,
              voiceOrder: reconciled.voiceOrder,
              voiceLabels: reconciled.voiceLabels,
              rangeAssignedNoteIds,
            },
            rerunSettings,
            "after-rerun",
            undefined,
            undefined,
            reassigned.provenance,
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

  function handleUndo() {
    // Undo/redo are authorized against the active side; a read-only view (the
    // diff) cannot mutate any branch (M14 -- closes the read-only undo leak).
    if (isCompareReadOnly || !undoEditorBranch()) {
      return;
    }
    setSkippedReviewNoteIds(new Set());
    setExportResult(null);
  }

  function handleRedo() {
    if (isCompareReadOnly || !redoEditorBranch()) {
      return;
    }
    setSkippedReviewNoteIds(new Set());
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
          {
            project,
            voiceOverrides,
            voiceOrder: [...voiceOrder],
            voiceLabels,
            rangeAssignedNoteIds,
          },
          {
            strategy: separationStrategy,
            assignmentMode,
            maxVoiceCount: selectedMaxVoiceCount ?? null,
          },
          "manual",
          name === "" ? undefined : name,
          undefined,
          editorDocument.assignmentProvenance,
        ),
      ),
    );
    setSnapshotNameDraft("");
  }

  // Restoring rewrites voiceOverrides, which doubles as the lock set the
  // next "Re-run separation" honors -- see editorSnapshots.ts C4. The
  // whole restore travels through one undoable editor transaction.
  function handleRestoreSnapshot(snapshot: NamedSnapshot) {
    const restored = restoreEditorState(snapshot);
    dispatchEditorCommand({
      kind: "restoreDocument",
      document: {
        ...editorDocument,
        ...restored,
        assignmentProvenance: snapshot.assignmentProvenance,
      },
    });
    setSkippedReviewNoteIds(new Set());
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
    const target = namedSnapshots.find((snapshot) => snapshot.id === diffTargetId);
    if (!target) {
      return;
    }
    // Fork B from the immutable snapshot into its own live editable branch;
    // the snapshot is never mutated by later B edits.
    forkEditorSideB(
      {
        documentId: "B",
        revision: 0,
        ...target.state,
        assignmentProvenance: target.assignmentProvenance,
      },
      target.id,
    );
    setCompareState(createComparisonWorkspace(diffTargetId));
    setPendingCompareExit(false);
    setInteractionMode("select");
    setSelectedNoteIds(new Set());
    setSoloVoiceId(null);
    setOnlyChangedNotes(false);
  }

  // The A/B toggle doubles as the active-side switch: viewing A or B makes that
  // side the editable one; "diff" is read-only, so editing stays on A. Context
  // that is voice/note-id specific to one side is cleared on every switch.
  function handleSetCompareViewing(viewing: CompareViewing) {
    setCompareState((current) => updateComparisonViewing(current, viewing));
    setEditorActiveSide(viewing === "B" ? "B" : "A");
    setPendingCompareExit(false);
    setInteractionMode("select");
    setSelectedNoteIds(new Set());
    setSoloVoiceId(null);
  }

  // Toggle between the single A/B/Diff canvas and the two-pane split. Leaving
  // split forces the diff-free single canvas onto the active side.
  function handleToggleSplitLayout() {
    setCompareState((current) =>
      current
        ? { ...current, layout: current.layout === "split" ? "single" : "split", viewing: "A" }
        : current,
    );
    setEditorActiveSide("A");
    setInteractionMode("select");
    setSelectedNoteIds(new Set());
    setSoloVoiceId(null);
  }

  // Split panes: clicking a pane makes its side the active (editable) one.
  function handleActivateSide(side: "A" | "B") {
    setEditorActiveSide(side);
  }

  // One split pane, driven entirely by its projection. Only the active side is
  // editable; clicking any pane activates it. Both panes share the global
  // selection, so selecting a note highlights it in both (shared note ids).
  function renderComparisonPane(sideProjection: SideProjection) {
    const { side, editable } = sideProjection;
    return (
      <div
        key={side}
        role="group"
        aria-label={`Side ${side} piano roll${editable ? " (editing)" : ""}`}
        className={editable ? "editor-pane editor-pane-active" : "editor-pane"}
        onPointerDownCapture={() => handleActivateSide(side)}
      >
        <div className="editor-pane-label">
          Side {side}
          {side === "A" ? " · Current" : " · Draft"}
          {editable ? " · editing" : ""}
        </div>
        <PianoRoll
          project={sideProjection.project}
          presentationKeyByVoiceId={sideProjection.presentationKeyByVoiceId}
          selectedNoteIds={selectedNoteIds}
          onSelectionChange={editable ? setSelectedNoteIds : () => {}}
          soloVoiceId={soloVoiceId}
          interactionMode={interactionMode}
          activeVoiceId={activeVoiceId}
          onPaintNotes={handlePaintNotes}
          paintTool={paintTool}
          brushRadius={brushRadius}
          onBrushRadiusChange={setBrushRadius}
          wandReach={wandReach}
          onAssignNotes={handleAssignNotesToVoice}
          onAuditionNotes={handleAuditionNotes}
          confidenceHeatmap={isConfidenceHeatOn}
          pitchMarkers={pitchMarkers}
          onPitchMarkersChange={setPitchMarkers}
          currentPlaybackTick={playback.currentTick}
          isPlaying={playback.isPlaying}
          onSeek={playback.seek}
          readOnly={!editable}
          viewMode={pianoRollViewMode}
          timeViewport={splitTimeViewport}
          onTimeViewportChange={setSplitTimeViewport}
          pitchViewport={linkPitchScroll ? splitPitchViewport : undefined}
          onPitchViewportChange={linkPitchScroll ? setSplitPitchViewport : undefined}
        />
      </div>
    );
  }

  function snapshotStateOfDocument(document: EditorDocument) {
    return {
      project: document.project,
      voiceOverrides: document.voiceOverrides,
      voiceOrder: [...document.voiceOrder],
      voiceLabels: { ...document.voiceLabels },
      rangeAssignedNoteIds: new Set(document.rangeAssignedNoteIds),
    };
  }

  function appendManualSnapshot(document: EditorDocument, name: string) {
    setNamedSnapshots((current) =>
      appendSnapshot(
        current,
        createNamedSnapshot(
          snapshotStateOfDocument(document),
          {
            strategy: separationStrategy,
            assignmentMode,
            maxVoiceCount: selectedMaxVoiceCount ?? null,
          },
          "manual",
          name,
          undefined,
          document.assignmentProvenance,
        ),
      ),
    );
  }

  // Save the current side-B draft as its own immutable named snapshot.
  function handleSaveSideBSnapshot() {
    if (!editorBranchB) {
      return;
    }
    appendManualSnapshot(editorBranchB.present, "Side B");
  }

  // Promote side B to the primary working result, preserving the pre-promotion
  // A as a snapshot first (M5). The promotion is one undoable A transaction.
  function handleUseSideB() {
    if (!editorBranchB) {
      return;
    }
    const promoted = editorBranchB.present;
    appendManualSnapshot(editorBranchA.present, "A before using B");
    setEditorActiveSide("A");
    dispatchEditorCommand({ kind: "restoreDocument", document: promoted });
    discardEditorSideB();
    setCompareState(null);
    setPendingCompareExit(false);
    setSelectedNoteIds(new Set());
    setSoloVoiceId(null);
    setExportResult(null);
  }

  // Exiting keeps A and drops B. Unsaved B edits are confirmed first so they
  // are never silently lost (M5).
  function handleExitCompare() {
    if (isSideBDirty && !pendingCompareExit) {
      setPendingCompareExit(true);
      return;
    }
    discardEditorSideB();
    setCompareState(null);
    setPendingCompareExit(false);
    setSelectedNoteIds(new Set());
    setSoloVoiceId(null);
  }

  function handleCancelExitCompare() {
    setPendingCompareExit(false);
  }

  function handleCreateVoice() {
    dispatchEditorCommand({
      kind: "createVoice",
      assignSelection: selectedNoteIds.size > 0 ? Array.from(selectedNoteIds) : undefined,
    });
    setExportResult(null);
  }

  function handleRenameVoice(voiceId: string, label: string) {
    dispatchEditorCommand({ kind: "renameVoice", voiceId, label });
  }

  function handleMergeVoice(fromVoiceId: string, toVoiceId: string) {
    if (!displayedProject || fromVoiceId === toVoiceId || toVoiceId === "") {
      return;
    }

    dispatchEditorCommand({ kind: "mergeVoice", from: fromVoiceId, to: toVoiceId });
    setActiveVoiceId((current) => (current === fromVoiceId ? null : current));
    setSoloVoiceId((current) => (current === fromVoiceId ? null : current));
    setExportResult(null);
  }

  function handleReorderVoice(voiceId: string, direction: -1 | 1) {
    dispatchEditorCommand({ kind: "reorderVoice", voiceId, direction });
  }

  function handleToggleSolo(voiceId: string) {
    setSoloVoiceId((current) => (current === voiceId ? null : voiceId));
  }

  function applyNoteReassignment(noteIds: string[], voiceId: string) {
    dispatchEditorCommand({ kind: "assignNotes", noteIds, voiceId });
    setExportResult(null);
  }

  function handlePaintNotes(noteIds: string[]) {
    if (!activeVoiceId) {
      return;
    }
    dispatchEditorCommand({ kind: "paintNotes", noteIds, voiceId: activeVoiceId });
    setExportResult(null);
  }

  /** Context-menu "Assign to" — same reassignment path, explicit voice. */
  function handleAssignNotesToVoice(noteIds: string[], voiceId: string) {
    if (noteIds.length === 0) {
      return;
    }
    applyNoteReassignment(noteIds, voiceId);
  }

  function handleAuditionNotes(notes: MidiNote[]) {
    if (!isAuditionEnabled) {
      return;
    }
    playback.audition(notes);
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

    dispatchEditorCommand({
      kind: "applyRangeAssignments",
      assignments: new Map(Object.entries(rangePatch)),
    });
    setSelectedNoteIds(new Set(Object.keys(rangePatch)));
    setExportResult(null);
  }

  function restoreEditorDocument(
    changes: Partial<
      Pick<
        EditorDocument,
        "project" | "voiceOverrides" | "voiceOrder" | "voiceLabels" | "rangeAssignedNoteIds"
      >
    >,
  ) {
    dispatchEditorCommand({
      kind: "restoreDocument",
      document: { ...editorDocument, ...changes },
    });
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
    const nextRangeAssignedNoteIds = new Set(rangeAssignedNoteIds);
    for (const noteId of repair.movedNoteIds) {
      nextRangeAssignedNoteIds.delete(noteId);
    }
    restoreEditorDocument({
      voiceOverrides: { ...voiceOverrides, ...repair.overrides },
      voiceOrder: repair.voiceOrder,
      voiceLabels: {
        ...voiceLabels,
        [repair.newVoiceId]: `${sourceLabel} high`,
      },
      rangeAssignedNoteIds: nextRangeAssignedNoteIds,
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
    const nextLabels = { ...voiceLabels };
    for (const item of repair.repairs) {
      const sourceLabel = sourceLabels.get(item.sourceVoiceId) ?? item.sourceVoiceId;
      nextLabels[item.newVoiceId] = `${sourceLabel} high`;
    }
    const nextRangeAssignedNoteIds = new Set(rangeAssignedNoteIds);
    for (const noteId of repair.movedNoteIds) {
      nextRangeAssignedNoteIds.delete(noteId);
    }
    restoreEditorDocument({
      voiceOverrides: { ...voiceOverrides, ...repair.overrides },
      voiceOrder: repair.voiceOrder,
      voiceLabels: nextLabels,
      rangeAssignedNoteIds: nextRangeAssignedNoteIds,
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
    const nextLabels = { ...voiceLabels };
    for (const item of repair.repairs) {
      const sourceLabel = sourceLabels.get(item.sourceVoiceId) ?? item.sourceVoiceId;
      nextLabels[item.newVoiceId] = `${sourceLabel} ${formatMidiChannel(item.movedChannel)}`;
    }
    const nextRangeAssignedNoteIds = new Set(rangeAssignedNoteIds);
    for (const noteId of repair.movedNoteIds) {
      nextRangeAssignedNoteIds.delete(noteId);
    }
    restoreEditorDocument({
      voiceOverrides: { ...voiceOverrides, ...repair.overrides },
      voiceOrder: repair.voiceOrder,
      voiceLabels: nextLabels,
      rangeAssignedNoteIds: nextRangeAssignedNoteIds,
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
    const nextRangeAssignedNoteIds = new Set(rangeAssignedNoteIds);
    for (const noteId of repair.movedNoteIds) {
      nextRangeAssignedNoteIds.delete(noteId);
    }
    restoreEditorDocument({
      voiceOverrides: { ...voiceOverrides, ...repair.overrides },
      voiceOrder: repair.voiceOrder,
      voiceLabels: {
        ...voiceLabels,
        [repair.newVoiceId]: `${sourceLabel} ${formatMidiChannel(repair.movedChannel)}`,
      },
      rangeAssignedNoteIds: nextRangeAssignedNoteIds,
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
    dispatchEditorCommand({
      kind: "assignNotes",
      noteIds: [currentFlaggedNote.id],
      voiceId: currentFlaggedNote.voiceId,
    });
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
    dispatchEditorCommand({ kind: "assignNotes", noteIds: [currentFlaggedNote.id], voiceId });
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

  function handleConflictStep(direction: 1 | -1) {
    const currentStartTick =
      selectedNotes.length > 0 ? Math.min(...selectedNotes.map((note) => note.startTick)) : null;
    const nextConflict = findNextConflict(voiceConflicts, currentStartTick, direction);
    if (nextConflict) {
      setSelectedNoteIds(new Set(nextConflict.noteIds));
    }
  }

  function handleSmartFix(suggestion: SmartFixSuggestion) {
    if (isCompareReadOnly) {
      return;
    }

    switch (suggestion.action.type) {
      case "select":
        setSelectedNoteIds(new Set(suggestion.action.noteIds));
        break;
      case "assign":
        applyNoteReassignment(suggestion.action.noteIds, suggestion.action.targetVoiceId);
        setSelectedNoteIds(new Set(suggestion.action.noteIds));
        setActiveVoiceId(suggestion.action.targetVoiceId);
        break;
      case "merge":
        handleMergeVoice(suggestion.action.sourceVoiceId, suggestion.action.targetVoiceId);
        setActiveVoiceId(suggestion.action.targetVoiceId);
        break;
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
            {voiceConflicts.length > 0 ? (
              <button
                type="button"
                className="secondary-button conflict-button"
                onClick={() => handleConflictStep(1)}
                disabled={isReassigning || isCompareReadOnly}
              >
                Next overlap ({voiceConflicts.length})
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
        <section className="smart-fixes" aria-label="Smart fix suggestions">
          <div className="smart-fixes-header">
            <h2>Smart fixes</h2>
            <span>{smartFixSuggestions.length} suggestion(s)</span>
          </div>
          {smartFixSuggestions.length > 0 ? (
            <ul className="smart-fixes-list">
              {smartFixSuggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <div>
                    <strong>{suggestion.title}</strong>
                    <span>{suggestion.reason}</span>
                    <span>{formatSmartFixActionDetail(suggestion, displayedProject.voices)}</span>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleSmartFix(suggestion)}
                    disabled={isReassigning || isCompareReadOnly}
                  >
                    {suggestion.actionLabel}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="smart-fixes-empty">No obvious correction suggestions for this file.</p>
          )}
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
              <AssignmentMetricPanel
                state={assignmentMetric.state}
                targetLabel={diffTarget?.name ?? "Target"}
                onRetry={assignmentMetric.retry}
              />
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
                  <p className="compare-active-hint">
                    A/B compare active — use the A / B / Diff toggle above the piano roll to switch
                    views.
                  </p>
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
      {compareState ? (
        <section
          className={
            isCompareReadOnly
              ? "compare-readonly-banner"
              : "compare-readonly-banner compare-readonly-banner-placeholder"
          }
          aria-live="polite"
          aria-hidden={isCompareReadOnly ? undefined : "true"}
        >
          Read-only preview: editing is disabled in the diff view. Switch to A or B to edit.
        </section>
      ) : null}

      <section
        className={
          isEditorFullscreen ? "editor-workspace editor-workspace-fullscreen" : "editor-workspace"
        }
        aria-label="MIDI editor workspace"
      >
        {displayedProject ? (
          <section className="piano-roll-toolbar">
            {compareState ? (
              <div className="compare-toolbar-group" aria-label="A/B compare preview controls">
                <div className="compare-view-toggle" role="group" aria-label="Compare view">
                  {(isSplitLayout ? (["A", "B"] as const) : (["A", "B", "diff"] as const)).map(
                    (viewing) => {
                      // In split, the A/B buttons pick the active (editable) side;
                      // in single they pick which side the one canvas shows.
                      const isActive = isSplitLayout
                        ? editorActiveSide === viewing
                        : compareState.viewing === viewing;
                      return (
                        <button
                          key={viewing}
                          type="button"
                          className={isActive ? "secondary-button active" : "secondary-button"}
                          onClick={() =>
                            isSplitLayout && viewing !== "diff"
                              ? handleActivateSide(viewing)
                              : handleSetCompareViewing(viewing)
                          }
                          aria-pressed={isActive ? "true" : "false"}
                        >
                          {viewing === "A" ? "A: Current" : viewing === "B" ? "B: Draft" : "Diff"}
                        </button>
                      );
                    },
                  )}
                </div>
                <button
                  type="button"
                  className={isSplitLayout ? "secondary-button active" : "secondary-button"}
                  onClick={handleToggleSplitLayout}
                  aria-pressed={isSplitLayout ? "true" : "false"}
                  title="Show sides A and B side by side"
                >
                  {isSplitLayout ? "Single view" : "Split view"}
                </button>
                {isSplitLayout ? (
                  <button
                    type="button"
                    className={linkPitchScroll ? "secondary-button active" : "secondary-button"}
                    onClick={() => setLinkPitchScroll((current) => !current)}
                    aria-pressed={linkPitchScroll ? "true" : "false"}
                    title="Scroll and zoom both panes' pitch axis together"
                  >
                    {linkPitchScroll ? "Pitch: linked" : "Pitch: independent"}
                  </button>
                ) : null}
                {pendingCompareExit ? (
                  <span className="compare-exit-confirm" role="alert">
                    Discard side B&rsquo;s unsaved edits?
                    <button type="button" className="secondary-button" onClick={handleExitCompare}>
                      Discard B
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleCancelExitCompare}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleUseSideB}
                      title="Make side B the working result and keep A as a snapshot"
                    >
                      Use B
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleSaveSideBSnapshot}
                      title="Save the side-B draft as its own snapshot"
                    >
                      Save B
                    </button>
                    <button type="button" className="secondary-button" onClick={handleExitCompare}>
                      Exit compare
                    </button>
                  </>
                )}
              </div>
            ) : null}
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
              className={isEditorFullscreen ? "secondary-button active" : "secondary-button"}
              onClick={() => setIsEditorFullscreen((current) => !current)}
              aria-pressed={isEditorFullscreen ? "true" : "false"}
            >
              {isEditorFullscreen ? "Exit fullscreen" : "Fullscreen workspace"}
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
            <button
              type="button"
              className={isAuditionEnabled ? "secondary-button active" : "secondary-button"}
              onClick={() => setIsAuditionEnabled((current) => !current)}
              aria-pressed={isAuditionEnabled ? "true" : "false"}
              title="Play a short blip for notes as you click or paint them"
            >
              {isAuditionEnabled ? "Audition: on" : "Audition: off"}
            </button>
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
              className={
                interactionMode === "paint" ? "secondary-button active" : "secondary-button"
              }
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
              className={
                interactionMode === "range" ? "secondary-button active" : "secondary-button"
              }
              onClick={handleToggleRangeMode}
              aria-pressed={interactionMode === "range" ? "true" : "false"}
              disabled={isCompareReadOnly}
            >
              {interactionMode === "range" ? "Range markers: on" : "Range markers: off"}
            </button>
            <button
              type="button"
              className={isConfidenceHeatOn ? "secondary-button active" : "secondary-button"}
              onClick={() => setIsConfidenceHeatOn((current) => !current)}
              aria-pressed={isConfidenceHeatOn ? "true" : "false"}
              title="Color notes by assignment confidence instead of voice (H)"
            >
              {isConfidenceHeatOn ? "Confidence heat: on" : "Confidence heat: off"}
            </button>
            {isConfidenceHeatOn ? (
              <span className="confidence-heat-legend">
                <span aria-hidden="true">uncertain</span>
                <span className="confidence-heat-gradient" aria-hidden="true" />
                <span aria-hidden="true">certain</span>
              </span>
            ) : null}
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
          {isSplitLayout && comparisonProjection.sideB ? (
            <div className="editor-split" aria-label="Split comparison of sides A and B">
              {renderComparisonPane(comparisonProjection.sideA)}
              {renderComparisonPane(comparisonProjection.sideB)}
            </div>
          ) : (
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
              onAuditionNotes={handleAuditionNotes}
              confidenceHeatmap={isConfidenceHeatOn}
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
              conflictNoteIds={pianoRollConflictNoteIds}
              viewMode={pianoRollViewMode}
            />
          )}
        </section>
      </section>

      <footer className="metrics-bar">{formatProjectSummary(displayedProject)}</footer>
    </main>
  );
}
