import { useCallback, useEffect, useRef, useState } from "react";
import type { MidiProject } from "../../domain/midi/midiProject";
import {
  compareAssignmentModelCosts,
  GENERAL_PURPOSE_EVALUATION_PROFILE,
  type AssignmentCostComparison,
  type AssignmentMetricReport,
} from "../../domain/midi/assignmentMetric";
import { evaluateAssignment } from "../../lib/tauri/commands";

export type AssignmentMetricComparisonState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      targetReport: AssignmentMetricReport;
      currentReport: AssignmentMetricReport;
      comparison: AssignmentCostComparison;
    }
  | {
      status: "error";
      targetReport: AssignmentMetricReport | null;
      currentReport: AssignmentMetricReport | null;
      targetError: string | null;
      currentError: string | null;
    };

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Assignment cost evaluation failed.";
}

export function useAssignmentMetricComparison(
  target: MidiProject | null,
  current: MidiProject | null,
): { state: AssignmentMetricComparisonState; retry: () => void } {
  const requestSequence = useRef(0);
  const [retrySequence, setRetrySequence] = useState(0);
  const [state, setState] = useState<AssignmentMetricComparisonState>({ status: "idle" });

  useEffect(() => {
    const requestId = ++requestSequence.current;
    if (!target || !current) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "loading" });
    const targetRequest = {
      ppq: target.ppq,
      notes: [...target.notes],
      profile: GENERAL_PURPOSE_EVALUATION_PROFILE,
    };
    const currentRequest = {
      ppq: current.ppq,
      notes: [...current.notes],
      profile: GENERAL_PURPOSE_EVALUATION_PROFILE,
    };

    void Promise.allSettled([
      evaluateAssignment(targetRequest),
      evaluateAssignment(currentRequest),
    ]).then(([targetResult, currentResult]) => {
      if (requestSequence.current !== requestId) {
        return;
      }
      if (targetResult.status === "fulfilled" && currentResult.status === "fulfilled") {
        setState({
          status: "ready",
          targetReport: targetResult.value,
          currentReport: currentResult.value,
          comparison: compareAssignmentModelCosts(
            targetRequest,
            currentRequest,
            targetResult.value,
            currentResult.value,
          ),
        });
        return;
      }
      setState({
        status: "error",
        targetReport: targetResult.status === "fulfilled" ? targetResult.value : null,
        currentReport: currentResult.status === "fulfilled" ? currentResult.value : null,
        targetError: targetResult.status === "rejected" ? errorMessage(targetResult.reason) : null,
        currentError:
          currentResult.status === "rejected" ? errorMessage(currentResult.reason) : null,
      });
    });

    return () => {
      if (requestSequence.current === requestId) {
        requestSequence.current += 1;
      }
    };
  }, [target, current, retrySequence]);

  const retry = useCallback(() => setRetrySequence((value) => value + 1), []);
  return { state, retry };
}
