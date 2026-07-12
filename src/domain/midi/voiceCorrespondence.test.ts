import { describe, expect, it } from "vitest";
import {
  correspondVoices,
  maxWeightMatching,
  VOICE_CORRESPONDENCE_MATCHER_VERSION,
  type CorrespondenceSide,
} from "./voiceCorrespondence";

function totalWeight(weights: number[][], pairs: readonly (readonly [number, number])[]): number {
  return pairs.reduce((sum, [row, col]) => sum + weights[row][col], 0);
}

// Reference maximum-weight matching by exhaustive search, to validate the
// Hungarian implementation on small matrices.
function bruteForceMaxWeight(weights: number[][]): number {
  const rows = weights.length;
  const cols = rows === 0 ? 0 : weights[0].length;
  const usedCol = new Array<boolean>(cols).fill(false);
  function best(row: number): number {
    if (row === rows) {
      return 0;
    }
    let result = best(row + 1); // leave this row unmatched
    for (let col = 0; col < cols; col += 1) {
      if (!usedCol[col] && weights[row][col] > 0) {
        usedCol[col] = true;
        result = Math.max(result, weights[row][col] + best(row + 1));
        usedCol[col] = false;
      }
    }
    return result;
  }
  return best(0);
}

function side(assignments: Record<string, string>, voiceIds?: string[]): CorrespondenceSide {
  return {
    voiceIds: voiceIds ?? [...new Set(Object.values(assignments))].sort(),
    assignments: new Map(Object.entries(assignments)),
  };
}

describe("maxWeightMatching", () => {
  it("returns positive-weight pairs only, disjoint in rows and columns", () => {
    const pairs = maxWeightMatching([
      [5, 0],
      [0, 3],
    ]);
    expect(pairs).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("chooses the global optimum where greedy would not", () => {
    // Greedy takes the single 9 first (row0->col0), stranding row1 at 0 for a
    // total of 9. The optimum pairs row0->col1 (8) and row1->col0 (8) = 16.
    const weights = [
      [9, 8],
      [8, 0],
    ];
    const pairs = maxWeightMatching(weights);
    expect(totalWeight(weights, pairs)).toBe(16);
  });

  it("matches brute force on random small matrices", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const rows = 1 + (rand() % 5);
      const cols = 1 + (rand() % 5);
      const weights = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => rand() % 6),
      );
      const pairs = maxWeightMatching(weights);
      // Disjointness.
      expect(new Set(pairs.map(([r]) => r)).size).toBe(pairs.length);
      expect(new Set(pairs.map(([, c]) => c)).size).toBe(pairs.length);
      expect(totalWeight(weights, pairs)).toBe(bruteForceMaxWeight(weights));
    }
  });
});

describe("correspondVoices", () => {
  it("pairs voices by shared-note overlap and reports the version", () => {
    const a = side({ n1: "voice-1", n2: "voice-1", n3: "voice-2" });
    const b = side({ n1: "voice-5", n2: "voice-5", n3: "voice-6" });
    const result = correspondVoices(a, b);
    expect(result.matched).toEqual([
      { aVoiceId: "voice-1", bVoiceId: "voice-5", overlap: 2 },
      { aVoiceId: "voice-2", bVoiceId: "voice-6", overlap: 1 },
    ]);
    expect(result.unmatchedA).toEqual([]);
    expect(result.unmatchedB).toEqual([]);
    expect(result.matcherVersion).toBe(VOICE_CORRESPONDENCE_MATCHER_VERSION);
  });

  it("is invariant to voice-id ordering on the input sides", () => {
    const a = side({ n1: "voice-1", n2: "voice-2" }, ["voice-2", "voice-1"]);
    const b = side({ n1: "voice-9", n2: "voice-8" }, ["voice-8", "voice-9"]);
    const forward = correspondVoices(a, b);
    const reordered = correspondVoices(
      { voiceIds: ["voice-1", "voice-2"], assignments: a.assignments },
      { voiceIds: ["voice-9", "voice-8"], assignments: b.assignments },
    );
    expect(reordered).toEqual(forward);
  });

  it("reports voices present on only one side as unmatched", () => {
    const a = side({ n1: "voice-1", n2: "voice-2" });
    const b = side({ n1: "voice-5" }); // n2 dropped from B entirely
    const result = correspondVoices(a, b);
    expect(result.matched).toEqual([{ aVoiceId: "voice-1", bVoiceId: "voice-5", overlap: 1 }]);
    expect(result.unmatchedA).toEqual(["voice-2"]);
    expect(result.unmatchedB).toEqual([]);
  });

  it("flags a tie as ambiguous", () => {
    // voice-1's two notes split evenly across voice-5 and voice-6: no unique best.
    const a = side({ n1: "voice-1", n2: "voice-1" });
    const b = side({ n1: "voice-5", n2: "voice-6" });
    const result = correspondVoices(a, b);
    expect(result.ambiguous).toContainEqual({ side: "A", voiceId: "voice-1" });
  });

  it("reports split and merge structure", () => {
    // A's voice-1 splits into B's voice-5 and voice-6; B's voice-7 merges A's voice-2 and voice-3.
    const a = side({ n1: "voice-1", n2: "voice-1", n3: "voice-2", n4: "voice-3" });
    const b = side({ n1: "voice-5", n2: "voice-6", n3: "voice-7", n4: "voice-7" });
    const result = correspondVoices(a, b);
    expect(result.splits).toContainEqual({ aVoiceId: "voice-1", bVoiceIds: ["voice-5", "voice-6"] });
    expect(result.merges).toContainEqual({ bVoiceId: "voice-7", aVoiceIds: ["voice-2", "voice-3"] });
  });

  it("corresponds percussion by role and keeps it out of the weight problem", () => {
    const a = side({ n1: "voice-1", d1: "percussion" }, ["voice-1", "percussion"]);
    const b = side({ n1: "voice-5", d1: "percussion" }, ["voice-5", "percussion"]);
    const result = correspondVoices(a, b);
    expect(result.matched).toContainEqual({
      aVoiceId: "percussion",
      bVoiceId: "percussion",
      overlap: 1,
    });
    expect(result.matched).toContainEqual({ aVoiceId: "voice-1", bVoiceId: "voice-5", overlap: 1 });
  });

  it("leaves one-sided percussion unmatched", () => {
    const a = side({ n1: "voice-1", d1: "percussion" }, ["voice-1", "percussion"]);
    const b = side({ n1: "voice-5" }, ["voice-5"]);
    const result = correspondVoices(a, b);
    expect(result.unmatchedA).toContain("percussion");
  });
});
