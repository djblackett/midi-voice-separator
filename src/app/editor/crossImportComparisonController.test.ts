import { describe, expect, it, vi } from "vitest";
import type { MidiProject } from "../../domain/midi/midiProject";
import type {
  CrossImportComparisonRequest,
  CrossImportComparisonResponse,
} from "../../lib/tauri/commands";
import {
  CrossImportComparisonController,
  type CrossImportComparisonTarget,
} from "./crossImportComparisonController";

function project(noteId: string, voiceId: string): MidiProject {
  return {
    notes: [{ id: noteId, voiceId }],
    voices: [{ id: voiceId }],
  } as MidiProject;
}

function target(revision = 1): CrossImportComparisonTarget {
  return {
    branchId: "A",
    documentId: "editable-1",
    revision,
    project: project("editable-note", "voice-7"),
  };
}

function response(request: CrossImportComparisonRequest): CrossImportComparisonResponse {
  return {
    reference: {
      documentId: request.referenceDocumentId,
      path: request.referencePath,
      project: project("reference-note", "lead"),
      provenance: { kind: "imported", algorithmVersion: 1 },
    },
    correspondence: {
      matcherVersion: 1,
      policy: "CROSS_IMPORT_V1",
      comparable: true,
      incomparableReason: null,
      referenceCoverage: { total: 1, exact: 1, fuzzy: 0, ambiguous: 0, unmatched: 0 },
      editableCoverage: { total: 1, exact: 1, fuzzy: 0, ambiguous: 0, unmatched: 0 },
      exactPairs: [
        {
          reference: { documentId: request.referenceDocumentId, noteId: "reference-note" },
          editable: { documentId: request.editable.documentId, noteId: "editable-note" },
        },
      ],
      fuzzyPairs: [],
      ambiguous: [],
      unmatchedReference: [],
      unmatchedEditable: [],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("CrossImportComparisonController", () => {
  it("drops an older pending request when a replacement request starts", async () => {
    const first = deferred<CrossImportComparisonResponse>();
    const second = deferred<CrossImportComparisonResponse>();
    const compare = vi
      .fn<(request: CrossImportComparisonRequest) => Promise<CrossImportComparisonResponse>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = new CrossImportComparisonController({
      compare,
      createReferenceId: (() => {
        let id = 0;
        return () => `reference-${++id}`;
      })(),
      now: () => 10,
    });
    const liveTarget = target();
    controller.setTarget(liveTarget);

    const oldLoad = controller.load("old.mid");
    const newLoad = controller.load("new.mid");
    const oldRequest = compare.mock.calls[0]?.[0];
    const newRequest = compare.mock.calls[1]?.[0];
    expect(newRequest?.editable.project).toBe(liveTarget.project);

    second.resolve(response(newRequest!));
    await newLoad;
    first.resolve(response(oldRequest!));
    await oldLoad;

    expect(controller.getState()).toMatchObject({
      status: "ready",
      reference: { documentId: "reference-2", sourcePath: "new.mid", importedAt: 10 },
    });
  });

  it("drops a response when an edit advances the target revision", async () => {
    const pending = deferred<CrossImportComparisonResponse>();
    const compare = vi
      .fn<(request: CrossImportComparisonRequest) => Promise<CrossImportComparisonResponse>>()
      .mockReturnValue(pending.promise);
    const controller = new CrossImportComparisonController({
      compare,
      createReferenceId: () => "reference-1",
    });
    controller.setTarget(target(1));

    const load = controller.load("reference.mid");
    const request = compare.mock.calls[0]?.[0] as CrossImportComparisonRequest;
    controller.setTarget(target(2));
    pending.resolve(response(request));
    await load;

    expect(controller.getState()).toEqual({ status: "idle", reference: null });
  });

  it("preserves the old reference while a replacement is loading, then replaces it only on success", async () => {
    const replacement = deferred<CrossImportComparisonResponse>();
    const compare = vi
      .fn<(request: CrossImportComparisonRequest) => Promise<CrossImportComparisonResponse>>()
      .mockImplementationOnce(async (request) => response(request))
      .mockReturnValueOnce(replacement.promise);
    const controller = new CrossImportComparisonController({
      compare,
      createReferenceId: (() => {
        let id = 0;
        return () => `reference-${++id}`;
      })(),
    });
    controller.setTarget(target());
    await controller.load("first.mid");

    const replacing = controller.load("second.mid");
    expect(controller.getState()).toMatchObject({
      status: "loading",
      reference: { documentId: "reference-1", sourcePath: "first.mid" },
    });
    const request = compare.mock.calls[1]?.[0] as CrossImportComparisonRequest;
    replacement.resolve(response(request));
    await replacing;

    expect(controller.getState()).toMatchObject({
      status: "ready",
      reference: { documentId: "reference-2", sourcePath: "second.mid" },
    });
  });

  it("keeps the previous reference on a recoverable replacement error and retries it", async () => {
    const compare = vi
      .fn<(request: CrossImportComparisonRequest) => Promise<CrossImportComparisonResponse>>()
      .mockImplementationOnce(async (request) => response(request))
      .mockRejectedValueOnce({ message: "could not read reference" })
      .mockImplementationOnce(async (request) => response(request));
    const controller = new CrossImportComparisonController({
      compare,
      createReferenceId: (() => {
        let id = 0;
        return () => `reference-${++id}`;
      })(),
    });
    controller.setTarget(target());

    await controller.load("first.mid");

    await controller.load("retry.mid");
    expect(controller.getState()).toMatchObject({
      status: "error",
      message: "could not read reference",
      reference: { documentId: "reference-1", sourcePath: "first.mid" },
    });
    await controller.retry();

    expect(controller.getState()).toMatchObject({
      status: "ready",
      reference: { documentId: "reference-2", sourcePath: "retry.mid" },
    });
    expect(compare.mock.calls.map(([request]) => request.referenceDocumentId)).toEqual([
      "reference-1",
      "reference-2",
      "reference-2",
    ]);
  });

  it("invalidates a ready derived result after a later edit but retains the reference", async () => {
    const compare = vi.fn(async (request: CrossImportComparisonRequest) => response(request));
    const controller = new CrossImportComparisonController({
      compare,
      createReferenceId: () => "reference-1",
    });
    controller.setTarget(target(1));
    await controller.load("reference.mid");
    expect(controller.getState().status).toBe("ready");

    controller.setTarget(target(2));

    const state = controller.getState();
    expect(state).toMatchObject({
      status: "outOfDate",
      reference: { documentId: "reference-1", sourcePath: "reference.mid" },
    });
    expect("diff" in state).toBe(false);
  });
});
