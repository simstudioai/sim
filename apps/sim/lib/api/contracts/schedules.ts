import { z } from 'zod'
import {
  mountedSecretNamesSchema,
  secretMountScopeSchema,
} from '@/lib/api/contracts/secret-mount-policy'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const scheduleStatusSchema = z.enum(['active', 'disabled', 'completed'])
export type ScheduleStatus = z.output<typeof scheduleStatusSchema>

export const scheduleSourceTypeSchema = z.enum(['workflow', 'job'])
export type ScheduleSourceType = z.output<typeof scheduleSourceTypeSchema>

export const scheduleLifecycleSchema = z.enum(['persistent', 'until_complete'])
export type ScheduleLifecycle = z.output<typeof scheduleLifecycleSchema>

/**
 * A `@`-mentioned resource or `/`-invoked skill captured with a scheduled
 * task's prompt. `kind` discriminates the variant and the remaining keys carry
 * the variant-specific identifiers (`workflowId`, `tableId`, `skillId`, …), so
 * the shape is intentionally open beyond the always-present `kind`/`label`.
 */
export const scheduleContextSchema = z
  .object({ kind: z.string().min(1), label: z.string() })
  .passthrough()

export type ScheduleContext = z.output<typeof scheduleContextSchema>

export const scheduleIdParamsSchema = z.object({
  id: z.string().min(1, 'Invalid schedule ID'),
})

export const scheduleQuerySchema = z.object({
  workflowId: z.string().optional(),
  workspaceId: z.string().optional(),
  blockId: z.string().optional(),
})

const workflowScheduleQuerySchema = z.object({
  workflowId: z.string().min(1).optional(),
  blockId: z.string().min(1).optional(),
})

/**
 * Mirrors a full `workflow_schedule` row as it appears on the wire after
 * `NextResponse.json` serialization. Single-schedule and workspace-list
 * responses both spread the full row, so the schema describes every column
 * (with NOT NULL columns required and timestamps as ISO strings).
 */
export const workflowScheduleRowSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  deploymentVersionId: z.string().nullable(),
  blockId: z.string().nullable(),
  cronExpression: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastRanAt: z.string().nullable(),
  lastQueuedAt: z.string().nullable(),
  triggerType: z.string(),
  timezone: z.string(),
  failedCount: z.number(),
  infraRetryCount: z.number(),
  status: scheduleStatusSchema,
  lastFailedAt: z.string().nullable(),
  /**
   * Legacy rows pre-dating the `sourceType` column can still surface in
   * workspace listings via `isNull(sourceType)` filters, so the wire may emit
   * `null` even though the column is `notNull` for new rows.
   */
  sourceType: scheduleSourceTypeSchema.nullable(),
  jobTitle: z.string().nullable(),
  prompt: z.string().nullable(),
  lifecycle: scheduleLifecycleSchema,
  successCondition: z.string().nullable(),
  maxRuns: z.number().nullable(),
  runCount: z.number(),
  sourceChatId: z.string().nullable(),
  sourceTaskName: z.string().nullable(),
  sourceUserId: z.string().nullable(),
  sourceWorkspaceId: z.string().nullable(),
  secretScope: secretMountScopeSchema,
  mountedSecrets: mountedSecretNamesSchema,
  jobHistory: z.array(z.object({ timestamp: z.string(), summary: z.string() })).nullable(),
  contexts: z.array(scheduleContextSchema).nullable(),
  excludedDates: z.array(z.string()).nullable(),
  endsAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type WorkflowScheduleRow = z.output<typeof workflowScheduleRowSchema>

/**
 * Workspace-scope listing extends the row with synthesized join fields.
 * Workflow-backed rows carry the workflow name from `workflow` (NOT NULL
 * column); job-backed rows synthesize `null` server-side.
 */
export const workspaceScheduleRowSchema = workflowScheduleRowSchema.extend({
  workflowName: z.string().nullable(),
})

export type WorkspaceScheduleRow = z.output<typeof workspaceScheduleRowSchema>

export const reactivateScheduleBodySchema = z.object({
  action: z.literal('reactivate'),
})

export type ReactivateScheduleBody = z.input<typeof reactivateScheduleBodySchema>

export const disableScheduleBodySchema = z.object({
  action: z.literal('disable'),
})

export type DisableScheduleBody = z.input<typeof disableScheduleBodySchema>

export const scheduleUpdateSchema = z.discriminatedUnion('action', [
  reactivateScheduleBodySchema,
  disableScheduleBodySchema,
])

export type ScheduleUpdate = z.input<typeof scheduleUpdateSchema>

const messageResponseSchema = z.object({
  message: z.string(),
  nextRunAt: z.string().optional(),
})

export const executeSchedulesResponseSchema = z.object({
  message: z.string(),
  status: z.literal('started'),
})

export type ExecuteSchedulesResponse = z.output<typeof executeSchedulesResponseSchema>

export const getScheduleContract = defineRouteContract({
  method: 'GET',
  path: '/api/schedules',
  query: workflowScheduleQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      schedule: workflowScheduleRowSchema.nullable(),
      isDisabled: z.boolean().optional(),
      hasFailures: z.boolean().optional(),
      canBeReactivated: z.boolean().optional(),
    }),
  },
})

export const listWorkspaceSchedulesContract = defineRouteContract({
  method: 'GET',
  path: '/api/schedules',
  query: z.object({
    workspaceId: z.string().min(1),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      schedules: z.array(workspaceScheduleRowSchema),
    }),
  },
})

/**
 * Single-schedule read by id: a lightweight fetch for one workflow schedule
 * instead of pulling the whole workspace list.
 */
export const getScheduleByIdContract = defineRouteContract({
  method: 'GET',
  path: '/api/schedules/[id]',
  params: scheduleIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      schedule: workflowScheduleRowSchema,
    }),
  },
})

/**
 * Re-arms a disabled schedule: the route recomputes `nextRunAt` from the stored
 * cron expression and clears the failure counters.
 */
export const reactivateScheduleContract = defineRouteContract({
  method: 'PUT',
  path: '/api/schedules/[id]',
  params: scheduleIdParamsSchema,
  body: reactivateScheduleBodySchema,
  response: {
    mode: 'json',
    schema: messageResponseSchema,
  },
})

export const updateScheduleContract = defineRouteContract({
  method: 'PUT',
  path: '/api/schedules/[id]',
  params: scheduleIdParamsSchema,
  body: scheduleUpdateSchema,
  response: {
    mode: 'json',
    schema: messageResponseSchema,
  },
})
