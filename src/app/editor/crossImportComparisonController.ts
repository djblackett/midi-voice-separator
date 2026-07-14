import type { MidiProject } from "../../domain/midi/midiProject";
import {
  diffCrossImportAssignments,
  type CrossImportDiff,
} from "../../domain/midi/crossImportDiff";
import type {
  CrossImportComparisonRequest,
  CrossImportComparisonResponse,
} from "../../lib/tauri/commands";
import {
  createReferenceDocument,
  createReferenceDocumentId,
  type ReferenceDocument,
  type ReferenceDocumentId,
} from "../referenceDocument";
import { canApplyCrossImportResult, type CrossImportRequestRef } from "./crossImportGuard";
import type { BranchId } from "./editorBranch";
import type { DocumentId } from "./editorDocument";

/** The materialized editable document that the native command compares. */
export interface CrossImportComparisonTarget {
  readonly branchId: BranchId;
  readonly documentId: DocumentId;
  readonly revision: number;
  readonly project: MidiProject;
}

export interface CrossImportRequest extends CrossImportRequestRef {
  readonly referencePath: string;
}

export type CrossImportComparisonState =
  | { readonly status: "idle"; readonly reference: ReferenceDocument | null }
  | {
      readonly status: "loading";
      readonly reference: ReferenceDocument | null;
      readonly request: CrossImportRequest;
    }
  | {
      readonly status: "ready";
      readonly reference: ReferenceDocument;
      readonly request: CrossImportRequest;
      readonly response: CrossImportComparisonResponse;
      readonly diff: CrossImportDiff;
    }
  | {
      readonly status: "outOfDate";
      readonly reference: ReferenceDocument;
      readonly request: CrossImportRequest;
    }
  | {
      readonly status: "error";
      readonly reference: ReferenceDocument | null;
      readonly request: CrossImportRequest;
      readonly message: string;
    };

export interface CrossImportComparisonControllerOptions {
  readonly compare: (
    request: CrossImportComparisonRequest,
  ) => Promise<CrossImportComparisonResponse>;
  readonly onStateChange?: (state: CrossImportComparisonState) => void;
  readonly createReferenceId?: () => ReferenceDocumentId;
  readonly now?: () => number;
}

/**
 * Narrow owner for derived external-comparison state. It intentionally has no
 * editor mutation methods: the caller supplies a materialized target, and all
 * accepted responses remain reference-plus-diagnostics data.
 */
export class CrossImportComparisonController {
  private target: CrossImportComparisonTarget | null = null;
  private requestSequence = 0;
  private lastRequest: CrossImportRequest | null = null;
  private state: CrossImportComparisonState = { status: "idle", reference: null };

  public constructor(private readonly options: CrossImportComparisonControllerOptions) {}

  public getState(): CrossImportComparisonState {
    return this.state;
  }

  /** Call whenever the live editable branch/document/revision changes. */
  public setTarget(target: CrossImportComparisonTarget | null): void {
    const changed = !sameTarget(this.target, target);
    this.target = target;
    if (!changed) {
      return;
    }

    // Invalidates all outstanding async responses before deriving the visible
    // state, so an edit cannot reinstate a former-revision result.
    this.requestSequence += 1;
    if (!target || !this.state.reference) {
      this.setState({ status: "idle", reference: this.state.reference });
      return;
    }
    const request = requestForReference(this.lastRequest, this.state.reference.documentId);
    if (request) {
      this.setState({ status: "outOfDate", reference: this.state.reference, request });
    } else {
      this.setState({ status: "idle", reference: this.state.reference });
    }
  }

  /** Starts a new selection. The existing reference remains until success. */
  public async load(referencePath: string): Promise<void> {
    await this.run(
      referencePath,
      this.options.createReferenceId?.() ?? createReferenceDocumentId(),
    );
  }

  /** Repeats the last request against the current editable revision. */
  public async retry(): Promise<void> {
    if (!this.lastRequest) {
      return;
    }
    await this.run(this.lastRequest.referencePath, this.lastRequest.referenceDocumentId);
  }

  /** Hides only derived comparison data; a loaded reference remains reusable. */
  public close(): void {
    this.requestSequence += 1;
    this.setState({ status: "idle", reference: this.state.reference });
  }

  /** Called when the primary import resets the editor session. */
  public reset(): void {
    this.requestSequence += 1;
    this.lastRequest = null;
    this.setState({ status: "idle", reference: null });
  }

  private async run(
    referencePath: string,
    referenceDocumentId: ReferenceDocumentId,
  ): Promise<void> {
    const target = this.target;
    if (!target) {
      return;
    }
    const request: CrossImportRequest = {
      requestId: ++this.requestSequence,
      branchId: target.branchId,
      documentId: target.documentId,
      revision: target.revision,
      referenceDocumentId,
      referencePath,
    };
    this.lastRequest = request;
    this.setState({ status: "loading", reference: this.state.reference, request });

    try {
      const response = await this.options.compare({
        referencePath,
        referenceDocumentId,
        editable: { documentId: target.documentId, project: target.project },
      });
      if (!this.isCurrent(request)) {
        return;
      }
      if (response.reference.documentId !== request.referenceDocumentId) {
        this.setState({
          status: "error",
          reference: this.state.reference,
          request,
          message: "The external comparison response did not match the requested reference.",
        });
        return;
      }

      const reference = createReferenceDocument({
        documentId: response.reference.documentId,
        sourcePath: response.reference.path,
        importedAt: this.options.now?.() ?? Date.now(),
        project: response.reference.project,
        assignmentProvenance: response.reference.provenance,
      });
      this.setState({
        status: "ready",
        reference,
        request,
        response,
        diff: diffCrossImportAssignments(
          toPairSide(reference.documentId, reference.project),
          toPairSide(target.documentId, target.project),
          response.correspondence,
        ),
      });
    } catch (error) {
      if (!this.isCurrent(request)) {
        return;
      }
      this.setState({
        status: "error",
        reference: this.state.reference,
        request,
        message: errorMessage(error),
      });
    }
  }

  private isCurrent(request: CrossImportRequest): boolean {
    const target = this.target;
    return (
      target !== null &&
      canApplyCrossImportResult(request, {
        requestId: this.requestSequence,
        branchId: target.branchId,
        documentId: target.documentId,
        revision: target.revision,
        referenceDocumentId: request.referenceDocumentId,
      })
    );
  }

  private setState(state: CrossImportComparisonState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

function toPairSide(documentId: string, project: MidiProject) {
  return {
    documentId,
    voiceIds: project.voices.map((voice) => voice.id),
    assignments: new Map(project.notes.map((note) => [note.id, note.voiceId])),
  };
}

function requestForReference(
  request: CrossImportRequest | null,
  referenceDocumentId: ReferenceDocumentId,
): CrossImportRequest | null {
  return request && request.referenceDocumentId === referenceDocumentId ? request : null;
}

function sameTarget(
  left: CrossImportComparisonTarget | null,
  right: CrossImportComparisonTarget | null,
): boolean {
  return (
    left?.branchId === right?.branchId &&
    left?.documentId === right?.documentId &&
    left?.revision === right?.revision
  );
}

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "External MIDI comparison failed.";
}
