import { z } from 'zod'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'

const persistedToolStateSchema = z.enum([
  ...Object.values(MothershipStreamV1ToolOutcome),
  'pending',
  'executing',
  'awaiting_approval',
  'interrupted',
])
export type PersistedToolState = z.infer<typeof persistedToolStateSchema>

const persistedToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: persistedToolStateSchema,
  params: z.record(z.string(), z.unknown()).optional(),
  result: z
    .object({ success: z.boolean(), output: z.unknown().optional(), error: z.string().optional() })
    .optional(),
  error: z.string().optional(),
  calledBy: z.string().optional(),
  durationMs: z.number().optional(),
  display: z.object({ title: z.string().optional() }).optional(),
})
export type PersistedToolCall = z.infer<typeof persistedToolCallSchema>

/** Canonical persisted blocks shared by display projection and partial-response HTTP writes. */
export const persistedContentBlockSchema = z.object({
  type: z.union([z.enum(MothershipStreamV1EventType), z.enum(['plan', 'task'])]),
  lane: z.enum(['main', 'subagent']).optional(),
  agent: z.string().optional(),
  channel: z.enum(MothershipStreamV1TextChannel).optional(),
  phase: z.enum(MothershipStreamV1ToolPhase).optional(),
  kind: z.enum(MothershipStreamV1SpanPayloadKind).optional(),
  lifecycle: z.enum(MothershipStreamV1SpanLifecycleEvent).optional(),
  status: z.enum(MothershipStreamV1CompletionStatus).optional(),
  content: z.string().optional(),
  name: z.string().optional(),
  toolCall: persistedToolCallSchema.optional(),
  planItems: z
    .array(z.object({ step: z.string(), status: z.enum(['pending', 'active', 'done']) }))
    .optional(),
  task: z
    .object({
      taskId: z.string(),
      kind: z.enum(['timer', 'workflow_run']),
      target: z.record(z.string(), z.unknown()),
      note: z.string(),
      status: z.enum(['pending', 'completed', 'failed', 'stopped', 'expired']).optional(),
      summary: z.string().optional(),
    })
    .optional(),
  timestamp: z.number().optional(),
  endedAt: z.number().optional(),
  error: z.string().optional(),
  parentToolCallId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
})
export type PersistedContentBlock = z.infer<typeof persistedContentBlockSchema>
