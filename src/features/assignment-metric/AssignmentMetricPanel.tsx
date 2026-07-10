import type {
  AssignmentCostComparison,
  AssignmentMetricComponent,
  AssignmentMetricReport,
  UnsupportedAssignmentCostReason,
} from "../../domain/midi/assignmentMetric";
import type { AssignmentMetricComparisonState } from "./useAssignmentMetricComparison";

const COMPONENT_LABELS: Record<AssignmentMetricComponent["id"], string> = {
  VOICE_COMPLEXITY: "Voice complexity",
  PITCH_MOTION: "Pitch motion",
  REGISTER_EXPANSION: "Register expansion",
  SILENCE_GAP: "Silence gap",
  CHANNEL_SWITCH: "Channel switches",
  VOICE_CROSSING: "Voice crossings",
};

const UNSUPPORTED_MESSAGES: Record<UnsupportedAssignmentCostReason, string> = {
  METRIC_MISMATCH: "No supported winner: the evaluator versions differ.",
  PROFILE_MISMATCH: "No supported winner: the evaluation profiles differ.",
  NOTE_UNIVERSE_MISMATCH: "No supported winner: the two sides do not contain the same notes.",
  HARD_VIOLATIONS: "No supported winner: at least one side has hard assignment violations.",
  MELODIC_VOICE_COUNT_MISMATCH:
    "No supported winner: the sides use different melodic voice counts.",
};

function formatCost(cost: number): string {
  return cost.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function outcomeText(comparison: AssignmentCostComparison, targetLabel: string): string {
  switch (comparison.status) {
    case "LOWER_TARGET":
      return `${targetLabel} has lower assignment/model cost by ${formatCost(comparison.delta)}.`;
    case "LOWER_CURRENT":
      return `Current has lower assignment/model cost by ${formatCost(comparison.delta)}.`;
    case "TIED":
      return "The two sides have equal assignment/model cost under this profile.";
    case "UNSUPPORTED":
      return UNSUPPORTED_MESSAGES[comparison.reason];
  }
}

function reportSummary(report: AssignmentMetricReport | null, label: string) {
  if (!report) {
    return (
      <div className="assignment-metric-side">
        <strong>{label}</strong>
        <span>Unavailable</span>
      </div>
    );
  }
  return (
    <div className="assignment-metric-side">
      <strong>{label}</strong>
      <span className="assignment-metric-total">{formatCost(report.totalCost)}</span>
      <span>
        {report.melodicVoiceCount} melodic voices · {report.excludedPercussionNoteCount} percussion
        notes excluded
      </span>
      {report.hardViolations.length > 0 ? (
        <span className="assignment-metric-warning">
          {report.hardViolations.length} hard violation type
          {report.hardViolations.length === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

export function AssignmentMetricPanel({
  state,
  targetLabel,
  onRetry,
}: {
  state: AssignmentMetricComparisonState;
  targetLabel: string;
  onRetry: () => void;
}) {
  if (state.status === "idle") {
    return null;
  }

  return (
    <section className="assignment-metric" aria-label="Assignment model cost">
      <div className="assignment-metric-heading">
        <div>
          <h3>Assignment/model cost</h3>
          <p>Assignment/model cost: lower is better under this profile.</p>
        </div>
        <span>General-purpose v1</span>
      </div>
      {state.status === "loading" ? (
        <p className="assignment-metric-status">Evaluating materialized assignments…</p>
      ) : null}
      {state.status === "error" ? (
        <>
          <div className="assignment-metric-sides">
            {reportSummary(state.targetReport, targetLabel)}
            {reportSummary(state.currentReport, "Current")}
          </div>
          <p className="assignment-metric-error">
            No supported winner: {state.targetError ?? state.currentError ?? "evaluation failed"}
          </p>
          <button type="button" className="secondary-button" onClick={onRetry}>
            Retry assignment cost
          </button>
        </>
      ) : null}
      {state.status === "ready" ? (
        <>
          <div className="assignment-metric-sides">
            {reportSummary(state.targetReport, targetLabel)}
            {reportSummary(state.currentReport, "Current")}
          </div>
          <p
            className={
              state.comparison.status === "UNSUPPORTED"
                ? "assignment-metric-warning"
                : "assignment-metric-outcome"
            }
          >
            {outcomeText(state.comparison, targetLabel)}
          </p>
          <table className="assignment-metric-components">
            <caption>Weighted component costs</caption>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">{targetLabel}</th>
                <th scope="col">Current</th>
              </tr>
            </thead>
            <tbody>
              {state.targetReport.components.map((targetComponent, index) => (
                <tr key={targetComponent.id}>
                  <th scope="row">{COMPONENT_LABELS[targetComponent.id]}</th>
                  <td>{formatCost(targetComponent.cost)}</td>
                  <td>{formatCost(state.currentReport.components[index]?.cost ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
