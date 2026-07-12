import { PERCUSSION_VOICE_ID } from "./voiceManagement";

/**
 * Deterministic maximum-weight bipartite voice correspondence (M9). Pairs the
 * voices of two same-lineage sides by shared-note overlap, choosing the
 * globally maximum-weight matching rather than a greedy largest-overlap-first
 * one, and reports the evidence downstream features need: unmatched voices,
 * per-pair overlap, tie/ambiguity, and split/merge structure.
 *
 * Voice ids are never treated as stable identity (M8); correspondence is the
 * only sanctioned way to relate voices across a re-run, import, or comparison.
 */
export const VOICE_CORRESPONDENCE_MATCHER_VERSION = 1;

export interface CorrespondenceSide {
  /** Melodic + percussion voice ids present on this side. */
  readonly voiceIds: readonly string[];
  /** noteId -> voiceId for this side. */
  readonly assignments: ReadonlyMap<string, string>;
}

export interface VoicePair {
  readonly aVoiceId: string;
  readonly bVoiceId: string;
  readonly overlap: number;
}

export interface VoiceSplit {
  readonly aVoiceId: string;
  readonly bVoiceIds: readonly string[];
}

export interface VoiceMerge {
  readonly bVoiceId: string;
  readonly aVoiceIds: readonly string[];
}

export interface AmbiguousVoice {
  readonly side: "A" | "B";
  readonly voiceId: string;
}

export interface VoiceCorrespondence {
  readonly matched: readonly VoicePair[];
  readonly unmatchedA: readonly string[];
  readonly unmatchedB: readonly string[];
  readonly ambiguous: readonly AmbiguousVoice[];
  readonly splits: readonly VoiceSplit[];
  readonly merges: readonly VoiceMerge[];
  readonly matcherVersion: number;
}

/**
 * Maximum-weight bipartite matching on a dense non-negative weight matrix,
 * returning the matched `[row, col]` pairs whose weight is positive. Unmatched
 * rows/cols are simply absent. Exact (Kuhn-Munkres / Hungarian, O(n^3)) and
 * deterministic for a fixed input ordering; voice counts are tiny.
 */
export function maxWeightMatching(
  weights: readonly (readonly number[])[],
): (readonly [number, number])[] {
  const rows = weights.length;
  const cols = rows === 0 ? 0 : weights[0].length;
  if (rows === 0 || cols === 0) {
    return [];
  }

  // Pad to a square cost matrix and minimize cost = (maxWeight - weight), which
  // maximizes total weight over a perfect assignment; padded/zero-weight cells
  // contribute nothing and are dropped afterwards.
  const n = Math.max(rows, cols);
  let maxWeight = 0;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      maxWeight = Math.max(maxWeight, weights[i][j]);
    }
  }
  const cost: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    cost.push(new Array<number>(n).fill(maxWeight));
    for (let j = 0; j < cols && i < rows; j += 1) {
      cost[i][j] = maxWeight - weights[i][j];
    }
  }

  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const parent = new Array<number>(n + 1).fill(0); // parent[col] = matched row (1-indexed)
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    parent[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = parent[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= n; j += 1) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[parent[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (parent[j0] !== 0);
    do {
      const j1 = way[j0];
      parent[j0] = parent[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const pairs: [number, number][] = [];
  for (let j = 1; j <= n; j += 1) {
    const row = parent[j] - 1;
    const col = j - 1;
    if (row < rows && col < cols && weights[row][col] > 0) {
      pairs.push([row, col]);
    }
  }
  pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return pairs;
}

function buildOverlap(
  a: CorrespondenceSide,
  b: CorrespondenceSide,
): Map<string, Map<string, number>> {
  const overlap = new Map<string, Map<string, number>>();
  for (const [noteId, aVoiceId] of a.assignments) {
    if (aVoiceId === PERCUSSION_VOICE_ID) {
      continue;
    }
    const bVoiceId = b.assignments.get(noteId);
    if (bVoiceId === undefined || bVoiceId === PERCUSSION_VOICE_ID) {
      continue;
    }
    const row = overlap.get(aVoiceId) ?? new Map<string, number>();
    row.set(bVoiceId, (row.get(bVoiceId) ?? 0) + 1);
    overlap.set(aVoiceId, row);
  }
  return overlap;
}

export function correspondVoices(
  a: CorrespondenceSide,
  b: CorrespondenceSide,
): VoiceCorrespondence {
  const aVoiceIds = a.voiceIds
    .filter((id) => id !== PERCUSSION_VOICE_ID)
    .slice()
    .sort();
  const bVoiceIds = b.voiceIds
    .filter((id) => id !== PERCUSSION_VOICE_ID)
    .slice()
    .sort();
  const overlap = buildOverlap(a, b);

  const weights = aVoiceIds.map((aId) => bVoiceIds.map((bId) => overlap.get(aId)?.get(bId) ?? 0));
  const matchedIndices = maxWeightMatching(weights);

  const matched: VoicePair[] = matchedIndices.map(([i, j]) => ({
    aVoiceId: aVoiceIds[i],
    bVoiceId: bVoiceIds[j],
    overlap: weights[i][j],
  }));

  // Percussion corresponds by its semantic role, outside the weight problem.
  const aHasPercussion = a.voiceIds.includes(PERCUSSION_VOICE_ID);
  const bHasPercussion = b.voiceIds.includes(PERCUSSION_VOICE_ID);
  if (aHasPercussion && bHasPercussion) {
    matched.push({
      aVoiceId: PERCUSSION_VOICE_ID,
      bVoiceId: PERCUSSION_VOICE_ID,
      overlap: sharedPercussionNotes(a, b),
    });
  }

  const matchedA = new Set(matched.map((pair) => pair.aVoiceId));
  const matchedB = new Set(matched.map((pair) => pair.bVoiceId));
  const unmatchedA = a.voiceIds
    .filter((id) => !matchedA.has(id))
    .slice()
    .sort();
  const unmatchedB = b.voiceIds
    .filter((id) => !matchedB.has(id))
    .slice()
    .sort();

  return {
    matched,
    unmatchedA,
    unmatchedB,
    ambiguous: collectAmbiguous(aVoiceIds, bVoiceIds, overlap),
    splits: collectSplits(aVoiceIds, overlap),
    merges: collectMerges(bVoiceIds, overlap),
    matcherVersion: VOICE_CORRESPONDENCE_MATCHER_VERSION,
  };
}

function sharedPercussionNotes(a: CorrespondenceSide, b: CorrespondenceSide): number {
  let shared = 0;
  for (const [noteId, aVoiceId] of a.assignments) {
    if (aVoiceId === PERCUSSION_VOICE_ID && b.assignments.get(noteId) === PERCUSSION_VOICE_ID) {
      shared += 1;
    }
  }
  return shared;
}

/** Voices whose single best overlap is tied by a second candidate (tie evidence). */
function collectAmbiguous(
  aVoiceIds: readonly string[],
  bVoiceIds: readonly string[],
  overlap: Map<string, Map<string, number>>,
): AmbiguousVoice[] {
  const ambiguous: AmbiguousVoice[] = [];
  for (const aId of aVoiceIds) {
    if (hasTiedBest(bVoiceIds.map((bId) => overlap.get(aId)?.get(bId) ?? 0))) {
      ambiguous.push({ side: "A", voiceId: aId });
    }
  }
  for (const bId of bVoiceIds) {
    if (hasTiedBest(aVoiceIds.map((aId) => overlap.get(aId)?.get(bId) ?? 0))) {
      ambiguous.push({ side: "B", voiceId: bId });
    }
  }
  return ambiguous;
}

function hasTiedBest(values: readonly number[]): boolean {
  const best = Math.max(0, ...values);
  return best > 0 && values.filter((value) => value === best).length > 1;
}

/** An A voice whose notes land in two or more B voices. */
function collectSplits(
  aVoiceIds: readonly string[],
  overlap: Map<string, Map<string, number>>,
): VoiceSplit[] {
  const splits: VoiceSplit[] = [];
  for (const aId of aVoiceIds) {
    const targets = [...(overlap.get(aId)?.entries() ?? [])]
      .filter(([, count]) => count > 0)
      .map(([bId]) => bId)
      .sort();
    if (targets.length >= 2) {
      splits.push({ aVoiceId: aId, bVoiceIds: targets });
    }
  }
  return splits;
}

/** A B voice whose notes came from two or more A voices. */
function collectMerges(
  bVoiceIds: readonly string[],
  overlap: Map<string, Map<string, number>>,
): VoiceMerge[] {
  const sources = new Map<string, string[]>();
  for (const [aId, row] of overlap) {
    for (const [bId, count] of row) {
      if (count > 0) {
        (sources.get(bId) ?? sources.set(bId, []).get(bId)!).push(aId);
      }
    }
  }
  const merges: VoiceMerge[] = [];
  for (const bId of bVoiceIds) {
    const aSources = (sources.get(bId) ?? []).slice().sort();
    if (aSources.length >= 2) {
      merges.push({ bVoiceId: bId, aVoiceIds: aSources });
    }
  }
  return merges;
}
