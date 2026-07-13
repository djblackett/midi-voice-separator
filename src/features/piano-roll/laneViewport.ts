import { MIN_VOICE_LANE_HEIGHT } from "./voiceLanes";

const DEFAULT_REVEAL_MARGIN_PX = 8;

export interface LaneViewportWindow {
  readonly scrollTopPx: number;
}

export interface ResolvedLaneViewport {
  readonly laneHeight: number;
  readonly contentHeight: number;
  readonly scrollTopPx: number;
  readonly maxScrollTopPx: number;
}

export interface LaneViewportContext {
  readonly voiceIds: readonly string[];
  readonly viewportHeight: number;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizedVoiceCount(voiceCount: number): number {
  return Number.isFinite(voiceCount) ? Math.max(0, Math.floor(voiceCount)) : 0;
}

function withScrollTop(current: LaneViewportWindow, scrollTopPx: number): LaneViewportWindow {
  return current.scrollTopPx === scrollTopPx ? current : { scrollTopPx };
}

export function defaultLaneViewportWindow(): LaneViewportWindow {
  return { scrollTopPx: 0 };
}

export function resolveLaneViewport(
  window: LaneViewportWindow,
  voiceCount: number,
  viewportHeight: number,
): ResolvedLaneViewport {
  const count = normalizedVoiceCount(voiceCount);
  const height = finiteNonNegative(viewportHeight);
  const laneHeight = Math.max(MIN_VOICE_LANE_HEIGHT, height / Math.max(1, count));
  const contentHeight = laneHeight * count;
  const maxScrollTopPx = Math.max(0, contentHeight - height);
  const requestedScrollTopPx = finiteNonNegative(window.scrollTopPx);

  return {
    laneHeight,
    contentHeight,
    scrollTopPx: Math.min(requestedScrollTopPx, maxScrollTopPx),
    maxScrollTopPx,
  };
}

export function clampLaneViewport(
  window: LaneViewportWindow,
  voiceCount: number,
  viewportHeight: number,
): LaneViewportWindow {
  const { scrollTopPx } = resolveLaneViewport(window, voiceCount, viewportHeight);
  return withScrollTop(window, scrollTopPx);
}

export function panLaneViewportBy(
  window: LaneViewportWindow,
  deltaPx: number,
  context: LaneViewportContext,
): LaneViewportWindow {
  const resolved = resolveLaneViewport(window, context.voiceIds.length, context.viewportHeight);
  const safeDeltaPx = Number.isFinite(deltaPx) ? deltaPx : 0;

  return clampLaneViewport(
    withScrollTop(window, resolved.scrollTopPx + safeDeltaPx),
    context.voiceIds.length,
    context.viewportHeight,
  );
}

export function revealLaneVoices(
  window: LaneViewportWindow,
  targetVoiceIds: readonly string[],
  context: LaneViewportContext,
  marginPx = DEFAULT_REVEAL_MARGIN_PX,
): LaneViewportWindow {
  const resolved = resolveLaneViewport(window, context.voiceIds.length, context.viewportHeight);
  const viewportHeight = finiteNonNegative(context.viewportHeight);
  const targetIndexes = targetVoiceIds
    .map((voiceId) => context.voiceIds.indexOf(voiceId))
    .filter((index) => index >= 0);

  if (targetIndexes.length === 0) {
    return withScrollTop(window, resolved.scrollTopPx);
  }

  const firstIndex = Math.min(...targetIndexes);
  const lastIndex = Math.max(...targetIndexes);
  const targetTopPx = firstIndex * resolved.laneHeight;
  const targetBottomPx = (lastIndex + 1) * resolved.laneHeight;
  const safeMarginPx = Math.min(finiteNonNegative(marginPx), viewportHeight / 2);
  const comfortableTopPx = resolved.scrollTopPx + safeMarginPx;
  const comfortableBottomPx = resolved.scrollTopPx + viewportHeight - safeMarginPx;

  let nextScrollTopPx = resolved.scrollTopPx;
  if (targetTopPx < comfortableTopPx) {
    nextScrollTopPx = targetTopPx - safeMarginPx;
  } else if (targetBottomPx > comfortableBottomPx) {
    nextScrollTopPx = targetBottomPx + safeMarginPx - viewportHeight;
  }

  return clampLaneViewport(
    withScrollTop(window, nextScrollTopPx),
    context.voiceIds.length,
    context.viewportHeight,
  );
}

function nearestSurvivingVoiceId(
  voiceIds: readonly string[],
  anchorIndex: number,
  nextVoiceIds: ReadonlySet<string>,
): string | null {
  const anchorVoiceId = voiceIds[anchorIndex];
  if (anchorVoiceId && nextVoiceIds.has(anchorVoiceId)) {
    return anchorVoiceId;
  }

  for (let distance = 1; distance < voiceIds.length; distance += 1) {
    const followingVoiceId = voiceIds[anchorIndex + distance];
    if (followingVoiceId && nextVoiceIds.has(followingVoiceId)) {
      return followingVoiceId;
    }

    const precedingVoiceId = voiceIds[anchorIndex - distance];
    if (precedingVoiceId && nextVoiceIds.has(precedingVoiceId)) {
      return precedingVoiceId;
    }
  }

  return null;
}

export function reconcileLaneViewport(
  window: LaneViewportWindow,
  previousContext: LaneViewportContext,
  nextContext: LaneViewportContext,
): LaneViewportWindow {
  if (previousContext.voiceIds.length === 0 || nextContext.voiceIds.length === 0) {
    return withScrollTop(window, 0);
  }

  const previous = resolveLaneViewport(
    window,
    previousContext.voiceIds.length,
    previousContext.viewportHeight,
  );
  const anchorIndex = Math.min(
    previousContext.voiceIds.length - 1,
    Math.floor(previous.scrollTopPx / previous.laneHeight),
  );
  const withinRowRatio =
    (previous.scrollTopPx - anchorIndex * previous.laneHeight) / previous.laneHeight;
  const anchorVoiceId = nearestSurvivingVoiceId(
    previousContext.voiceIds,
    anchorIndex,
    new Set(nextContext.voiceIds),
  );

  if (!anchorVoiceId) {
    return withScrollTop(window, 0);
  }

  const next = resolveLaneViewport(
    defaultLaneViewportWindow(),
    nextContext.voiceIds.length,
    nextContext.viewportHeight,
  );
  const nextAnchorIndex = nextContext.voiceIds.indexOf(anchorVoiceId);

  return clampLaneViewport(
    withScrollTop(window, nextAnchorIndex * next.laneHeight + withinRowRatio * next.laneHeight),
    nextContext.voiceIds.length,
    nextContext.viewportHeight,
  );
}

export function laneViewportAnchor(
  window: LaneViewportWindow,
  context: LaneViewportContext,
): string | null {
  if (context.voiceIds.length === 0) {
    return null;
  }

  const resolved = resolveLaneViewport(window, context.voiceIds.length, context.viewportHeight);
  const anchorIndex = Math.min(
    context.voiceIds.length - 1,
    Math.floor(resolved.scrollTopPx / resolved.laneHeight),
  );

  return context.voiceIds[anchorIndex] ?? null;
}
