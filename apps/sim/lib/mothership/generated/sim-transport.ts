// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/sim-transport.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";
import { RunControlRequest } from "./run-control";
import { TaskWakeRequest, WorkflowWatchRequest } from "./tasks";

export const SimConnection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("direct") }),
  z.object({ mode: z.literal("checkpoint"), channelId: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export type SimConnection = z.infer<typeof SimConnection>;

export const SimScope = z.object({
  userId: z.string().min(1),
  workspaceId: z.uuid(),
  chatId: z.uuid(),
});
export type SimScope = z.infer<typeof SimScope>;

/** Only idempotent controls use the idle channel; tool effects use the run event log. */
export const SimControlOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run_control"), input: RunControlRequest }),
  z.object({ kind: z.literal("workflow_status"), input: WorkflowWatchRequest }),
  z.object({ kind: z.literal("wake"), input: TaskWakeRequest }),
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

export const SimChannelPoll = z.object({ channelId: z.string().regex(/^[a-f0-9]{64}$/) });
export const SimChannelBatch = z.object({ requests: z.array(SimControlRequest).max(16) });
export const SimChannelReply = SimChannelPoll.extend({
  id: z.uuid(),
  result: SimControlResult,
});
