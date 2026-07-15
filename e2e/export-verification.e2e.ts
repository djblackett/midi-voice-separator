import { expect, test, type Page } from "@playwright/test";
import type { RoundTripVerificationReport } from "../src/lib/tauri/commands";
import { buildFixtureProject, installFakeTauri, note, voice } from "./fixtures/tauriMock";

const project = buildFixtureProject(
  [note("lead", "voice-1", 60, 0), note("bass", "voice-2", 48, 480)],
  [voice("voice-1", "Lead", 1, 60, 60), voice("voice-2", "Bass", 1, 48, 48)],
);

function report(
  status: RoundTripVerificationReport["status"],
  overrides: Partial<RoundTripVerificationReport> = {},
): RoundTripVerificationReport {
  return {
    verifierVersion: 1,
    matcherVersion: 1,
    policy: "STRICT_ROUND_TRIP_V1",
    status,
    noteSummary: {
      expectedNoteCount: 2,
      reimportedNoteCount: 2,
      exactMatchMultiplicity: 2,
      contentPreserved: true,
      ambiguousExactGroupCount: 0,
      missingExpected: [],
      unexpectedReimported: [],
    },
    voicePartition: {
      unambiguousPairCount: 2,
      ambiguousDuplicateGroupCount: 0,
      comparable: true,
      preserved: true,
    },
    metadata: {
      ppqPreserved: true,
      durationPreserved: true,
      tempoMapPreserved: true,
      timeSignaturesPreserved: true,
    },
    differences: [],
    ...overrides,
  };
}

async function importAndExport(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  await page.getByRole("button", { name: "Export MIDI" }).click();
}

function verificationCard(page: Page) {
  return page.getByLabel("Export round-trip verification");
}

test("presents a verified application-model report and retires the pre-export reminder", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: project,
    exportVerification: report("VERIFIED"),
  });
  await page.goto("/");
  await importAndExport(page);

  await expect(verificationCard(page)).toContainText("Verified application model");
  await expect(verificationCard(page)).toContainText("Verifier v1 · strict matcher v1");
  await expect(verificationCard(page)).toContainText(
    "Timeline metadata: PPQ, duration, tempo map, and time signatures preserved.",
  );
  await expect(page.getByLabel("Export readiness summary")).not.toContainText("Round trip");
});

test("discloses supported-model difference categories", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    exportVerification: report("DIFFERENCES_FOUND", {
      noteSummary: {
        expectedNoteCount: 2,
        reimportedNoteCount: 1,
        exactMatchMultiplicity: 1,
        contentPreserved: false,
        ambiguousExactGroupCount: 0,
        missingExpected: [{ documentId: "expected-export", noteId: "lead" }],
        unexpectedReimported: [],
      },
      metadata: {
        ppqPreserved: true,
        durationPreserved: true,
        tempoMapPreserved: true,
        timeSignaturesPreserved: false,
      },
      differences: [
        {
          kind: "MISSING_NOTE",
          expectedNotes: [{ documentId: "expected-export", noteId: "lead" }],
          reimportedNotes: [],
          expectedVoiceId: "voice-1",
          reimportedVoiceId: null,
        },
        {
          kind: "TIME_SIGNATURES",
          expectedNotes: [],
          reimportedNotes: [],
          expectedVoiceId: null,
          reimportedVoiceId: null,
        },
      ],
    }),
  });
  await page.goto("/");
  await importAndExport(page);

  const card = verificationCard(page);
  await expect(card).toContainText("Differences found");
  await expect(card).toContainText("Note content: differences found");
  await expect(card).toContainText("Timeline metadata differs: time signatures.");
  await card.getByText("2 reported difference categories.").click();
  await expect(card).toContainText("Missing notes");
  await expect(card).toContainText("Time signatures");
});

test("keeps export available for an inconclusive duplicate partition", async ({ page }) => {
  await installFakeTauri(page, {
    importedProject: project,
    exportVerification: report("INCONCLUSIVE", {
      voicePartition: {
        unambiguousPairCount: 0,
        ambiguousDuplicateGroupCount: 1,
        comparable: false,
        preserved: false,
      },
      differences: [
        {
          kind: "AMBIGUOUS_DUPLICATE_PARTITION",
          expectedNotes: [],
          reimportedNotes: [],
          expectedVoiceId: null,
          reimportedVoiceId: null,
        },
      ],
    }),
  });
  await page.goto("/");
  await importAndExport(page);

  await expect(verificationCard(page)).toContainText("Inconclusive application-model verification");
  await expect(verificationCard(page)).toContainText(
    "Voice partition: not fully comparable (0 unambiguous pairs; 1 ambiguous duplicate group).",
  );
  await expect(page.getByRole("button", { name: "Export MIDI" })).toBeEnabled();
});

test("distinguishes a successful write from a failed readback and suggests retrying", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: project,
    exportVerification: report("COULD_NOT_VERIFY"),
  });
  await page.goto("/");
  await importAndExport(page);

  await expect(verificationCard(page)).toContainText("Could not verify written file");
  await expect(verificationCard(page)).toContainText(
    "The export was written, but its exact bytes could not be verified.",
  );
  await expect(verificationCard(page)).toContainText(
    "Try exporting again after checking that the destination remains readable.",
  );
});

test("drops a report after a current-document edit and restores the pre-export reminder", async ({
  page,
}) => {
  await installFakeTauri(page, {
    importedProject: project,
    exportVerification: report("VERIFIED"),
  });
  await page.goto("/");
  await importAndExport(page);
  await expect(verificationCard(page)).toBeVisible();

  await page.getByLabel("Select notes in Lead", { exact: true }).click();
  await page.keyboard.press("2");

  await expect(verificationCard(page)).toBeHidden();
  await expect(page.getByLabel("Export readiness summary")).toContainText("Round trip");
});
