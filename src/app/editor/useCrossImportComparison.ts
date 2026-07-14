import { useCallback, useEffect, useRef, useState } from "react";
import { compareExternalMidi } from "../../lib/tauri/commands";
import {
  CrossImportComparisonController,
  type CrossImportComparisonState,
  type CrossImportComparisonTarget,
} from "./crossImportComparisonController";

/** React adapter for the narrow guarded controller; UI wiring comes in C2. */
export function useCrossImportComparison(target: CrossImportComparisonTarget | null): {
  readonly state: CrossImportComparisonState;
  readonly load: (referencePath: string) => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly close: () => void;
  readonly reset: () => void;
} {
  const [state, setState] = useState<CrossImportComparisonState>({
    status: "idle",
    reference: null,
  });
  const controllerRef = useRef<CrossImportComparisonController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CrossImportComparisonController({
      compare: compareExternalMidi,
      onStateChange: setState,
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.setTarget(target);
  }, [controller, target]);

  return {
    state,
    load: useCallback((referencePath: string) => controller.load(referencePath), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
    close: useCallback(() => controller.close(), [controller]),
    reset: useCallback(() => controller.reset(), [controller]),
  };
}
