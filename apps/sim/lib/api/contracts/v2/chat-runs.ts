import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2ChatRunStatusSchema = z.enum([
  'active',
  'paused_waiting_for_tool',
  'resuming',
  'complete',
  'error',
  'cancelled',
])

export type V2ChatRunStatus = z.output<typeof v2ChatRunStatusSchema>

/** Safe, durable metadata for one root Mothership chat run. */
export const v2ChatRunSummarySchema = z.object({
  runId: z.string().uuid(),
  chatId: z.string().uuid(),
  chatTitle: z.string().nullable(),
  status: v2ChatRunStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
})

export type V2ChatRunSummary = z.output<typeof v2ChatRunSummarySchema>

const v2ChatRunActivityStateSchema = z.enum(['running', 'complete', 'error'])

export const v2ChatRunActivitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['subagent', 'tool']),
    id: z.string().min(1),
    parentId: z.string().min(1).optional(),
    label: z.string(),
    state: v2ChatRunActivityStateSchema,
  }),
  z.object({
    kind: z.literal('narration'),
    parentId: z.string().min(1),
    delta: z.string(),
  }),
])

export type V2ChatRunActivity = z.output<typeof v2ChatRunActivitySchema>

export const v2ChatRunDetailSchema = v2ChatRunSummarySchema.extend({
  /** Accumulated root-assistant response; empty until public text is available. */
  response: z.string(),
  /** Chronological, display-safe activity updates projected from replay. */
  activities: z.array(v2ChatRunActivitySchema),
})

export type V2ChatRunDetail = z.output<typeof v2ChatRunDetailSchema>

export const v2ListChatRunsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    status: v2ChatRunStatusSchema.optional(),
    limit: z.coerce
      .number()
      .optional()
      .default(30)
      .transform((value) => Math.min(Math.max(1, Math.trunc(value)), 100)),
    cursor: z.string().min(1).optional(),
  })
  .strict()

export type V2ListChatRunsQuery = z.output<typeof v2ListChatRunsQuerySchema>

export const v2ChatRunParamsSchema = z.object({ runId: z.string().uuid() }).strict()

export const v2GetChatRunQuerySchema = z.object({ workspaceId: workspaceIdSchema }).strict()

export const v2ListChatRunsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/chat/runs',
  query: v2ListChatRunsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2ChatRunSummarySchema) },
})

export const v2GetChatRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/chat/runs/[runId]',
  params: v2ChatRunParamsSchema,
  query: v2GetChatRunQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ChatRunDetailSchema) },
})
