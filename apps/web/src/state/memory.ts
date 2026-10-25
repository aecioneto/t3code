import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const memoryListQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:memory:list",
  tag: WS_METHODS.memoryList,
  staleTimeMs: 0,
  idleTtlMs: 60_000,
});

export const memoryCreate = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:memory:create",
  tag: WS_METHODS.memoryCreate,
});

export const memoryUpdate = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:memory:update",
  tag: WS_METHODS.memoryUpdate,
});

export const memoryDelete = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:memory:delete",
  tag: WS_METHODS.memoryDelete,
});

export const memoryUndoThread = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:memory:undo-thread",
  tag: WS_METHODS.memoryUndoThread,
});

export const memorySeed = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:memory:seed",
  tag: WS_METHODS.memorySeed,
});
