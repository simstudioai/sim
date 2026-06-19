import { z } from 'zod'
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

export const createScheduleBodySchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    title: z.string().min(1, 'Title is required'),
    prompt: z.string().min(1, 'Prompt is required'),
    /** Recurring cadence. Omit (with `time` set) for a one-time task. */
    cronExpression: z.string().min(1).optional(),
    /** One-time launch instant (ISO 8601). Omit (with `cronExpression` set) for a recurring task. */
    time: z.string().min(1).optional(),
    timezone: z.string().optional().default('UTC'),
    lifecycle: scheduleLifecycleSchema.optional().default('persistent'),
    /** Recurrence end after N runs (gcal "ends after N occurrences"). */
    maxRuns: z.number().int().positive().optional(),
    /** Recurrence end on a date (ISO 8601; gcal "ends on date"). */
    endsAt: z.string().optional(),
    startDate: z.string().optional(),
    contexts: z.array(scheduleContextSchema).optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.cronExpression && !body.time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['time'],
        message: 'Provide a cron expression for a recurring task or a time for a one-time task',
      })
    }
  })

export type CreateScheduleBody = z.input<typeof createScheduleBodySchema>

export const reactivateScheduleBodySchema = z.object({
  action: z.literal('reactivate'),
})

export type ReactivateScheduleBody = z.input<typeof reactivateScheduleBodySchema>

export const disableScheduleBodySchema = z.object({
  action: z.literal('disable'),
})

export type DisableScheduleBody = z.input<typeof disableScheduleBodySchema>

export const updateScheduleBodySchema = z.object({
  action: z.literal('update'),
  title: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  cronExpression: z.string().nullable().optional(),
  /** One-time launch instant (ISO 8601). Switches a task to one-time when set alongside a null `cronExpression`. */
  time: z.string().min(1).optional(),
  timezone: z.string().optional(),
  lifecycle: scheduleLifecycleSchema.optional(),
  maxRuns: z.number().int().positive().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  contexts: z.array(scheduleContextSchema).optional(),
})

export type UpdateScheduleBody = z.input<typeof updateScheduleBodySchema>

/**
 * Deletes a single occurrence of a recurring task (gcal "this event"): the
 * occurrence's instant is added to the schedule's exclusion list and the next
 * run advances past it. Deleting the whole series uses {@link deleteScheduleContract}.
 */
export const excludeOccurrenceBodySchema = z.object({
  action: z.literal('exclude_occurrence'),
  occurrence: z.string().min(1, 'Occurrence timestamp is required'),
})

export type ExcludeOccurrenceBody = z.input<typeof excludeOccurrenceBodySchema>

export const scheduleUpdateSchema = z.discriminatedUnion('action', [
  reactivateScheduleBodySchema,
  disableScheduleBodySchema,
  updateScheduleBodySchema,
  excludeOccurrenceBodySchema,
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
 * Single-schedule read by id. Used by the mothership resource viewer so opening
 * a scheduled-task artifact does a lightweight by-id fetch instead of pulling
 * the entire workspace schedule list (which contended with the chat stream).
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
 * Newly-created job schedules emit a partial summary with the canonical fields
 * the route synthesizes server-side; everything else is filled in on
 * subsequent reads.
 */
export const createScheduleResponseSchema = z.object({
  schedule: z.object({
    id: z.string(),
    status: scheduleStatusSchema,
    /** Null for one-time tasks, which carry no recurring cadence. */
    cronExpression: z.string().nullable(),
    nextRunAt: z.string(),
  }),
})

export type CreateScheduleResponse = z.output<typeof createScheduleResponseSchema>

export const createScheduleContract = defineRouteContract({
  method: 'POST',
  path: '/api/schedules',
  body: createScheduleBodySchema,
  response: {
    mode: 'json',
    schema: createScheduleResponseSchema,
  },
})

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

export const disableScheduleContract = defineRouteContract({
  method: 'PUT',
  path: '/api/schedules/[id]',
  params: scheduleIdParamsSchema,
  body: disableScheduleBodySchema,
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

export const excludeOccurrenceContract = defineRouteContract({
  method: 'PUT',
  path: '/api/schedules/[id]',
  params: scheduleIdParamsSchema,
  body: excludeOccurrenceBodySchema,
  response: {
    mode: 'json',
    schema: messageResponseSchema,
  },
})

export const deleteScheduleContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/schedules/[id]',
  params: scheduleIdParamsSchema,
  response: {
    mode: 'json',
    schema: messageResponseSchema,
  },
})

export const executeSchedulesContract = defineRouteContract({
  method: 'GET',
  path: '/api/schedules/execute',
  response: {
    mode: 'json',
    schema: executeSchedulesResponseSchema,
  },
})
