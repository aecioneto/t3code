import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const routerClassify = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:router:classify",
  tag: WS_METHODS.routerClassify,
});

export const routerRecordChoice = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:router:record-choice",
  tag: WS_METHODS.routerRecordChoice,
});

export const routerPlanWorkspace = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:router:plan-workspace",
  tag: WS_METHODS.routerPlanWorkspace,
});

export const routerRecordWorkspaceChoice = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:router:record-workspace-choice",
  tag: WS_METHODS.routerRecordWorkspaceChoice,
});

export const routerProfileQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:router:profile",
  tag: WS_METHODS.routerGetProfile,
  staleTimeMs: 0,
  idleTtlMs: 60_000,
});

export const routerUpdateProfile = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:router:update-profile",
  tag: WS_METHODS.routerUpdateProfile,
});
