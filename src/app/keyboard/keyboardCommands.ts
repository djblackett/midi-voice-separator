/**
 * The keyboard command registry (M14). Bindings are declared separately from
 * the commands they run, and `resolveKeyboardCommand` is the single choke point
 * that turns a key event into an *authorized* command id -- applying the focus
 * guard, binding match, and permission gates (project present, active side
 * editable, comparison open) in one place so no shortcut can fire while typing
 * in a field or bypass the read-only rules. The busy gate and key-repeat policy
 * are layered on in a later slice.
 */
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
  | "assignVoice1"
  | "assignVoice2"
  | "assignVoice3"
  | "assignVoice4"
  | "assignVoice5"
  | "assignVoice6"
  | "assignVoice7"
  | "assignVoice8"
  | "assignVoice9"
  | "activateSideA"
  | "activateSideB";

/** A modifier of `undefined` means "don't care"; `true`/`false` must match. */
export interface KeyChord {
  readonly key: string;
  readonly ctrlOrMeta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export interface KeyboardEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
}

export interface KeyboardContext {
  readonly focusInEditableField: boolean;
  readonly hasProject: boolean;
  /** False in the read-only diff view (the active side cannot be edited). */
  readonly activeSideEditable: boolean;
  /** An async editor operation (e.g. a re-run) is in flight. */
  readonly busy: boolean;
  /** A comparison workspace is open (side switching only applies then). */
  readonly comparisonOpen: boolean;
}

interface CommandSpec {
  readonly id: KeyboardCommandId;
  readonly chord: KeyChord;
  /** Requires a loaded project. */
  readonly requiresProject: boolean;
  /** Blocked when the active side is read-only (the diff view). */
  readonly requiresEditable: boolean;
  /** Only applies while a comparison is open. */
  readonly requiresComparison?: boolean;
  /** Mutates the document (used by the busy gate). */
  readonly mutating: boolean;
  /** Allowed to fire on auto-repeat when the key is held. */
  readonly repeatable?: boolean;
}

const assignVoiceSpecs: CommandSpec[] = Array.from({ length: 9 }, (_, index) => ({
  id: `assignVoice${index + 1}` as KeyboardCommandId,
  chord: { key: String(index + 1) },
  requiresProject: true,
  requiresEditable: true,
  mutating: true,
  repeatable: true,
}));

// Declared in priority order; the first matching, permitted spec wins.
const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    id: "redo",
    chord: { key: "z", ctrlOrMeta: true, shift: true },
    requiresProject: false,
    requiresEditable: false,
    mutating: true,
    repeatable: true,
  },
  {
    id: "undo",
    chord: { key: "z", ctrlOrMeta: true, shift: false },
    requiresProject: false,
    requiresEditable: false,
    mutating: true,
    repeatable: true,
  },
  {
    id: "clearSelectionOrExitPaint",
    chord: { key: "Escape" },
    requiresProject: false,
    requiresEditable: false,
    mutating: false,
  },
  {
    id: "stepFlaggedBackward",
    chord: { key: "Tab", shift: true },
    requiresProject: false,
    requiresEditable: true,
    mutating: false,
    repeatable: true,
  },
  {
    id: "stepFlaggedForward",
    chord: { key: "Tab", shift: false },
    requiresProject: false,
    requiresEditable: true,
    mutating: false,
    repeatable: true,
  },
  {
    id: "toolPencil",
    chord: { key: "p", ctrlOrMeta: false, alt: false },
    requiresProject: true,
    requiresEditable: true,
    mutating: false,
  },
  {
    id: "toolBrush",
    chord: { key: "b", ctrlOrMeta: false, alt: false },
    requiresProject: true,
    requiresEditable: true,
    mutating: false,
  },
  {
    id: "toolLasso",
    chord: { key: "l", ctrlOrMeta: false, alt: false },
    requiresProject: true,
    requiresEditable: true,
    mutating: false,
  },
  {
    id: "toolWand",
    chord: { key: "w", ctrlOrMeta: false, alt: false },
    requiresProject: true,
    requiresEditable: true,
    mutating: false,
  },
  {
    id: "brushSmaller",
    chord: { key: "[" },
    requiresProject: true,
    requiresEditable: true,
    mutating: false,
    repeatable: true,
  },
  {
    id: "brushLarger",
    chord: { key: "]" },
    requiresProject: true,
    requiresEditable: true,
    mutating: false,
    repeatable: true,
  },
  {
    id: "toggleConfidenceHeat",
    chord: { key: "h", ctrlOrMeta: false, alt: false },
    requiresProject: true,
    requiresEditable: true,
    mutating: false,
  },
  ...assignVoiceSpecs,
];

function matchesModifier(required: boolean | undefined, actual: boolean): boolean {
  return required === undefined || required === actual;
}

function chordMatches(event: KeyboardEventLike, chord: KeyChord): boolean {
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) {
    return false;
  }
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  return (
    matchesModifier(chord.ctrlOrMeta, ctrlOrMeta) &&
    matchesModifier(chord.shift, event.shiftKey) &&
    matchesModifier(chord.alt, event.altKey)
  );
}

/**
 * Resolves a key event to the authorized command id it should run, or `null`
 * when no permitted command matches. Finer, command-specific applicability
 * (e.g. a flagged note exists, paint mode is active, a selection is present)
 * stays with the command's run-function, which no-ops when unmet -- exactly as
 * the pre-registry handlers did.
 */
export function resolveKeyboardCommand(
  event: KeyboardEventLike,
  context: KeyboardContext,
): KeyboardCommandId | null {
  if (context.focusInEditableField) {
    return null;
  }
  const spec = COMMAND_SPECS.find((candidate) => chordMatches(event, candidate.chord));
  if (!spec) {
    return null;
  }
  if (spec.requiresProject && !context.hasProject) {
    return null;
  }
  if (spec.requiresComparison && !context.comparisonOpen) {
    return null;
  }
  if (spec.requiresEditable && !context.activeSideEditable) {
    return null;
  }
  return spec.id;
}
