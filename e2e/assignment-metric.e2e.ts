import { expect, test, type Page } from "@playwright/test";
import type { AssignmentEvaluationRequest } from "../src/domain/midi/assignmentMetric";
import {
  buildAssignmentMetricReport,
  buildFixtureProject,
  installFakeTauri,
  note,
  voice,
} from "./fixtures/tauriMock";

const metricProject = buildFixtureProject(
  [
    note("a", "voice-1", 48, 0),
    note("b", "voice-1", 52, 240),
    note("c", "voice-2", 72, 480),
    note("d", "voice-2", 76, 720),
  ],
  [voice("voice-1", "Voice 1", 2, 48, 52), voice("voice-2", "Voice 2", 2, 72, 76)],
);

async function importAndCompareToImport(page: Page) {
  await page.getByRole("button", { name: "Import MIDI" }).click();
  const value = await page
    .locator(".diff-target-select option", { hasText: "Import" })
    .getAttribute("value");
  await page.locator(".diff-target-select").selectOption(value ?? "");
}

test.describe("assignment model cost", () => {
  test("evaluates materialized assignments and ignores unapplied rerun controls", async ({
    page,
  }) => {
    const requests: AssignmentEvaluationRequest[] = [];
    await installFakeTauri(page, {
      importedProject: metricProject,
      evaluateAssignment: (request) => {
        requests.push(structuredClone(request));
        return buildAssignmentMetricReport(request);
      },
    });
    await page.goto("/");
    await importAndCompareToImport(page);

    await expect(
      page.getByText("Assignment/model cost: lower is better under this profile."),
    ).toBeVisible();
    await expect(
      page.getByText("The two sides have equal assignment/model cost under this profile."),
    ).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);

    await page.getByLabel("Select notes in Voice 1", { exact: true }).click();
    await page.keyboard.press("2");
    await expect.poll(() => requests.length).toBe(4);
    expect(requests[3].notes.every((item) => item.voiceId === "voice-2")).toBe(true);

    await page.locator(".separation-strategy-select").selectOption("REGISTER_PRIORITY");
    await page.locator(".assignment-mode-select").selectOption("GLOBAL");
    await page.locator(".max-voice-count-input").fill("4");
    await page.waitForTimeout(150);
    expect(requests).toHaveLength(4);
  });

  test("renders an eligible lower-current claim without calling it quality", async ({ page }) => {
    let call = 0;
    await installFakeTauri(page, {
      importedProject: metricProject,
      evaluateAssignment: (request) =>
        buildAssignmentMetricReport(request, { totalCost: ++call % 2 === 1 ? 20 : 10 }),
    });
    await page.goto("/");
    await importAndCompareToImport(page);

    await expect(page.getByText("Current has lower assignment/model cost by 10.")).toBeVisible();
    await expect(page.locator(".assignment-metric")).not.toContainText(
      /quality|better separation/i,
    );
  });

  test("suppresses winners for voice-count mismatch and hard violations", async ({ page }) => {
    let call = 0;
    await installFakeTauri(page, {
      importedProject: metricProject,
      evaluateAssignment: (request) => {
        call += 1;
        return buildAssignmentMetricReport(
          request,
          call % 2 === 0
            ? { totalCost: 1, melodicVoiceCount: 3 }
            : { totalCost: 20, melodicVoiceCount: 2 },
        );
      },
    });
    await page.goto("/");
    await importAndCompareToImport(page);
    await expect(
      page.getByText(/No supported winner: the sides use different melodic voice counts/),
    ).toBeVisible();

    // Reinstall on a new page so the second policy is isolated from the first callback's sequence.
    const secondPage = await page.context().newPage();
    let secondCall = 0;
    await installFakeTauri(secondPage, {
      importedProject: metricProject,
      evaluateAssignment: (request) => {
        secondCall += 1;
        return buildAssignmentMetricReport(request, {
          totalCost: secondCall % 2 === 0 ? 1 : 20,
          hardViolations:
            secondCall % 2 === 0
              ? [
                  {
                    kind: "MELODIC_SAME_VOICE_OVERLAP",
                    occurrenceCount: 1,
                    affectedNoteIds: ["a", "b"],
                  },
                ]
              : [],
        });
      },
    });
    await secondPage.goto("/");
    await importAndCompareToImport(secondPage);
    await expect(
      secondPage.getByText(/No supported winner: at least one side has hard assignment violations/),
    ).toBeVisible();
    await secondPage.close();
  });

  test("discards stale evaluations after the materialized current side changes", async ({
    page,
  }) => {
    let call = 0;
    await installFakeTauri(page, {
      importedProject: metricProject,
      evaluateAssignment: async (request) => {
        call += 1;
        const thisCall = call;
        const isOldPair = thisCall <= 2;
        await new Promise((resolve) => setTimeout(resolve, isOldPair ? 300 : 20));
        const isTarget = thisCall % 2 === 1;
        const totalCost = isOldPair ? (isTarget ? 5 : 20) : isTarget ? 20 : 5;
        return buildAssignmentMetricReport(request, { totalCost });
      },
    });
    await page.goto("/");
    await importAndCompareToImport(page);
    await expect.poll(() => call).toBeGreaterThanOrEqual(2);

    await page.getByLabel("Rename Voice 1").fill("Bass");
    await expect(page.getByText("Current has lower assignment/model cost by 15.")).toBeVisible();
    await page.waitForTimeout(350);
    await expect(page.getByText("Current has lower assignment/model cost by 15.")).toBeVisible();
  });

  test("keeps a partial failure non-claiming and retries both sides", async ({ page }) => {
    let call = 0;
    await installFakeTauri(page, {
      importedProject: metricProject,
      evaluateAssignment: (request) => {
        call += 1;
        if (call === 1) {
          throw new Error("evaluator temporarily unavailable");
        }
        return buildAssignmentMetricReport(request);
      },
    });
    await page.goto("/");
    await importAndCompareToImport(page);

    await expect(
      page.getByText(/No supported winner: evaluator temporarily unavailable/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry assignment cost" }).click();
    await expect(
      page.getByText("The two sides have equal assignment/model cost under this profile."),
    ).toBeVisible();
    expect(call).toBe(4);
  });
});
