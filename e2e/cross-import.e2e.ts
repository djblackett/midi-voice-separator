import { expect, test } from "@playwright/test";
import type {
  CrossImportComparisonRequest,
  CrossImportComparisonResponse,
} from "../src/lib/tauri/commands";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const editableProject = buildFixtureProject(
  [note("editable-lead", "voice-1", 60, 0), note("editable-bass", "voice-2", 48, 480)],
  [voice("voice-1", "Lead", 1, 60, 60), voice("voice-2", "Bass", 1, 48, 48)],
);

const referenceProject = buildFixtureProject(
  [note("reference-lead", "ref-1", 60, 0), note("reference-bass", "ref-2", 48, 480)],
  [voice("ref-1", "Reference lead", 1, 60, 60), voice("ref-2", "Reference bass", 1, 48, 48)],
  { fileName: "regenerated.mid" },
);

function comparisonResponse(request: CrossImportComparisonRequest): CrossImportComparisonResponse {
  return {
    reference: {
      documentId: request.referenceDocumentId,
      path: request.referencePath,
      project: referenceProject,
      provenance: { kind: "imported", algorithmVersion: 1 },
    },
    correspondence: {
      matcherVersion: 1,
      policy: "CROSS_IMPORT_V1",
      comparable: true,
      incomparableReason: null,
      referenceCoverage: { total: 2, exact: 2, fuzzy: 0, ambiguous: 0, unmatched: 0 },
      editableCoverage: { total: 2, exact: 2, fuzzy: 0, ambiguous: 0, unmatched: 0 },
      exactPairs: [
        {
          reference: { documentId: request.referenceDocumentId, noteId: "reference-lead" },
          editable: { documentId: request.editable.documentId, noteId: "editable-lead" },
        },
        {
          reference: { documentId: request.referenceDocumentId, noteId: "reference-bass" },
          editable: { documentId: request.editable.documentId, noteId: "editable-bass" },
        },
      ],
      fuzzyPairs: [],
      ambiguous: [],
      unmatchedReference: [],
      unmatchedEditable: [],
    },
  };
}

async function importFixture(page: Parameters<typeof installFakeTauri>[0]) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.waitForSelector(".diff-summary");
}

function voiceRow(page: Parameters<typeof installFakeTauri>[0], label: string) {
  return page.locator(".voice-legend li").filter({
    has: page.getByLabel("Select notes in " + label, { exact: true }),
  });
}

test("loads the materialized editor as an immutable external reference, replaces it, and closes it", async ({
  page,
}) => {
  const requests: CrossImportComparisonRequest[] = [];
  await installFakeTauri(page, {
    importedProject: editableProject,
    importPath: "C:/references/regenerated.mid",
    compareExternal: (request) => {
      requests.push(structuredClone(request));
      return comparisonResponse(request);
    },
  });
  await page.goto("/");
  await importFixture(page);

  await page.getByLabel("Select notes in Lead", { exact: true }).click();
  await page.keyboard.press("2");
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  await page.getByRole("button", { name: "Compare external MIDI…" }).click();
  await expect(page.getByText("External reference: regenerated.mid")).toBeVisible();
  const summary = page.getByLabel("External MIDI comparison summary");
  await expect(summary).toContainText("Policy CROSS_IMPORT_V1 · matcher v1");
  await expect(summary).toContainText("Reference matcher coverage");
  await expect(summary).toContainText("2 total · 2 exact · 0 fuzzy · 0 ambiguous · 0 unmatched");
  await expect(summary).toContainText("Reference trusted-pair coverage");
  await expect(summary).toContainText("Reassigned paired notes");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]?.editable).toEqual({
    documentId: "A",
    project: expect.objectContaining({
      notes: expect.arrayContaining([
        expect.objectContaining({ id: "editable-lead", voiceId: "voice-2" }),
        expect.objectContaining({ id: "editable-bass", voiceId: "voice-2" }),
      ]),
    }),
  });

  await page.getByRole("button", { name: "Replace external MIDI…" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]?.referenceDocumentId).not.toBe(requests[1]?.referenceDocumentId);

  await page.getByRole("button", { name: "Close external comparison" }).click();
  await expect(page.getByText("External reference: regenerated.mid")).toBeHidden();
  await expect(page.getByRole("button", { name: "Reopen external reference" })).toBeEnabled();
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");
});

test("keeps the loaded reference and working editor through stale and failed replacement states", async ({
  page,
}) => {
  let calls = 0;
  await installFakeTauri(page, {
    importedProject: editableProject,
    importPath: "C:/references/regenerated.mid",
    compareExternal: (request) => {
      calls += 1;
      if (calls === 3) {
        throw new Error("reference MIDI is temporarily unavailable");
      }
      return comparisonResponse(request);
    },
  });
  await page.goto("/");
  await importFixture(page);

  await page.getByRole("button", { name: "Compare external MIDI…" }).click();
  await expect(page.getByText("External reference: regenerated.mid")).toBeVisible();

  await page.getByLabel("Select notes in Lead", { exact: true }).click();
  await page.keyboard.press("2");
  await expect(
    page.getByText("The external comparison is out of date after an editor change."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Recompute external match" }).click();
  await expect(page.getByText("External reference: regenerated.mid")).toBeVisible();

  await page.getByRole("button", { name: "Replace external MIDI…" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "External MIDI comparison failed: reference MIDI is temporarily unavailable",
  );
  await expect(page.getByText("External reference: regenerated.mid")).toBeVisible();
  await expect(voiceRow(page, "Lead")).toContainText("0 notes");
  await expect(voiceRow(page, "Bass")).toContainText("2 notes");

  await page.getByRole("button", { name: "Retry external MIDI" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByText("External reference: regenerated.mid")).toBeVisible();
});

test("reports insufficient matcher coverage without publishing assignment or voice counts", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: editableProject,
    importPath: "C:/references/unrelated.mid",
    compareExternal: (request) => {
      const response = comparisonResponse(request);
      return {
        ...response,
        correspondence: {
          ...response.correspondence,
          comparable: false,
          incomparableReason: "INSUFFICIENT_COVERAGE",
          referenceCoverage: { total: 4, exact: 1, fuzzy: 0, ambiguous: 1, unmatched: 2 },
          editableCoverage: { total: 4, exact: 1, fuzzy: 0, ambiguous: 1, unmatched: 2 },
          exactPairs: [response.correspondence.exactPairs[0]!],
          ambiguous: [
            {
              kind: "DUPLICATE_EXACT",
              reference: [
                { documentId: request.referenceDocumentId, noteId: "reference-ambiguous" },
              ],
              editable: [{ documentId: request.editable.documentId, noteId: "editable-ambiguous" }],
            },
          ],
          unmatchedReference: [
            { documentId: request.referenceDocumentId, noteId: "reference-only-1" },
            { documentId: request.referenceDocumentId, noteId: "reference-only-2" },
          ],
          unmatchedEditable: [
            { documentId: request.editable.documentId, noteId: "editable-only-1" },
            { documentId: request.editable.documentId, noteId: "editable-only-2" },
          ],
        },
      };
    },
  });
  await page.goto("/");
  await importFixture(page);

  await page.getByRole("button", { name: "Compare external MIDI…" }).click();
  const summary = page.getByLabel("External MIDI comparison summary");
  await expect(summary).toContainText("4 total · 1 exact · 0 fuzzy · 1 ambiguous · 2 unmatched");
  await expect(summary).toContainText(
    "The matcher found too little related note coverage to compare assignments.",
  );
  await expect(summary).not.toContainText("Reassigned paired notes");
  await expect(summary).not.toContainText("Matched voices");

  await summary.getByText(/Ambiguity and unmatched notes/).click();
  await expect(summary).toContainText(/reference-ambiguous \(reference-\d+\)/);
  await expect(summary).toContainText("editable-ambiguous (A)");
  await expect(summary).toContainText("reference-only-1");
  await expect(summary).toContainText("editable-only-1 (A)");
});
