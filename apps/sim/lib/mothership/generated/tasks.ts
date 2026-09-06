// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/tasks.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const WorkflowWatchRequest = z.object({
  chatId: z.string().uuid(),
  executionId: z.string().min(1).max(200),
});

export const WorkflowWatchStatus = z.object({
  workflowId: z.string().min(1).max(200),
  status: z.enum(["pending", "completed", "failed"]),
  summary: z.string().max(4000),
  output: z.string().max(2_000_000).optional(),
});
export type WorkflowWatchStatus = z.infer<typeof WorkflowWatchStatus>;

export const TaskWakeRequest = z.object({
  taskId: z.string().uuid(),
  runId: z.string().uuid(),
  chatId: z.string().uuid(),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  message: z.string().min(1).max(20_000),
  status: z.enum(["completed", "failed", "stopped", "expired"]),
  summary: z.string().max(4000),
});
export type TaskWakeRequest = z.infer<typeof TaskWakeRequest>;

export const TaskWakeAccepted = z.object({ accepted: z.literal(true) });

export const TaskStatusRequest = z.object({ taskId: z.string().uuid() });
export const TaskStatus = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["pending", "completed", "failed", "stopped", "expired"]),
  summary: z.string().nullable(),
});
export const InternalTaskStatus = TaskStatus.extend({ chatId: z.string().uuid() });
