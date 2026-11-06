// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/sim-transport.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";
import { RecallChatsRequest } from "./chat-recall";
import { IntegrationCatalogRequest } from "./integration-catalog";
import { MemoryNotesAccessInput } from "./memory-notes-access";
import { MemoryScopeRequest } from "./memory-scope";
import { RunControlRequest } from "./run-control";
import { TaskWakeRequest, WorkflowWatchRequest } from "./tasks";

const SimChannelId = z.string().regex(/^[a-f0-9]{64}$/);

export const SimConnection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("direct") }),
  z.object({ mode: z.literal("checkpoint"), channelId: SimChannelId }),
]);
export type SimConnection = z.infer<typeof SimConnection>;

export const SimScope = z
  .object({
    userId: z.string().min(1),
    workspaceId: z.uuid().optional(),
    organizationId: z.string().min(1).max(200).optional(),
    chatId: z.uuid(),
  })
  .refine((scope) => Boolean(scope.workspaceId) !== Boolean(scope.organizationId), {
    message: "Exactly one workspaceId or organizationId is required",
  });
export type SimScope = z.infer<typeof SimScope>;

/** Only idempotent controls use the idle channel; tool effects use the run event log. */
export const SimControlOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("memory_notes_access"), input: MemoryNotesAccessInput }),
  z.object({ kind: z.literal("memory_scope"), input: MemoryScopeRequest }),
  z.object({ kind: z.literal("run_control"), input: RunControlRequest }),
  z.object({ kind: z.literal("workflow_status"), input: WorkflowWatchRequest }),
  z.object({ kind: z.literal("wake"), input: TaskWakeRequest }),
  z.object({ kind: z.literal("workspace_context"), input: z.object({ workspaceId: z.uuid() }) }),
  z.object({ kind: z.literal("integration_catalog"), input: IntegrationCatalogRequest }),
  z.object({ kind: z.literal("recall_chats"), input: RecallChatsRequest }),
]);
export type SimControlOperation = z.infer<typeof SimControlOperation>;

export const SimControlRequest = z.object({
  id: z.uuid(),
  scope: SimScope,
  operation: SimControlOperation,
  expiresAt: z.number().int().positive(),
});
export type SimControlRequest = z.infer<typeof SimControlRequest>;

/** HTTP and outbound delivery preserve the same status and JSON response bytes. */
export const SimControlResult = z.object({
  status: z.number().int().min(200).max(599),
  body: z.string().max(16_000_000),
});
export type SimControlResult = z.infer<typeof SimControlResult>;

export type SimControlKind = SimControlOperation["kind"];
/** Every kind this build's union parses: what a receiver declares in `accepts`. */
export const SIM_CONTROL_KINDS: SimControlKind[] = SimControlOperation.options.map(
  (option) => option.shape.kind.value,
);

/** The v1.0.0 kinds every receiver parses without declaring them. Frozen: a poll without
 * `accepts` comes from a receiver that knows only these, so every later kind is negotiated. */
export const SIM_CONTROL_BASELINE_KINDS = [
  "run_control",
  "workflow_status",
  "wake",
  "workspace_context",
  "integration_catalog",
] as const satisfies readonly SimControlKind[];
export type BaselineSimControlKind = (typeof SIM_CONTROL_BASELINE_KINDS)[number];
export type NegotiatedSimControlKind = Exclude<SimControlKind, BaselineSimControlKind>;

/** Error code of the 501 answer for a kind the receiving Sim did not declare. */
export const SIM_CONTROL_UNSUPPORTED = "sim_control_unsupported";

/** `accepts` is free-form so a newer Sim's kinds never fail an older worker's poll. */
export const SimChannelPoll = z.object({
  channelId: SimChannelId,
  accepts: z.array(z.string().min(1).max(64)).max(64).optional(),
});
/** The worker's typed batch; receivers parse `SimChannelBatchEnvelope` instead. */
export const SimChannelBatch = z.object({ requests: z.array(SimControlRequest).max(16) });
/** Receivers parse each request alone, so one unknown kind never poisons its batch-mates. */
export const SimChannelBatchEnvelope = z.object({ requests: z.array(z.unknown()).max(16) });
/** Enough of a request to answer it when its operation does not parse. */
export const SimControlRequestHeader = z.object({
  id: z.uuid(),
  operation: z.object({ kind: z.string() }).optional().catch(undefined),
});
export const SimChannelReply = z.object({
  channelId: SimChannelId,
  id: z.uuid(),
  result: SimControlResult,
});
