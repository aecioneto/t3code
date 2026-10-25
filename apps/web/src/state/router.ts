import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const routerClassify = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:router:classify",
  tag: WS_METHODS.routerClassify,
});

export const routerRecordChoice = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:router:record-choice",
  tag: WS_METHODS.routerRecordChoice,
});
