import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const scheduleStatusSchema = z.enum(['active', 'disabled', 'completed'])
type ScheduleStatus = z.output<typeof scheduleStatusSchema>

const scheduleSourceTypeSchema = z.enum(['workflow', 'job'])
type ScheduleSourceType = z.output<typeof scheduleSourceTypeSchema>

const scheduleLifecycleSchema = z.enum(['persistent', 'until_complete'])
export type ScheduleLifecycle = z.output<typeof scheduleLifecycleSchema>

const scheduleIdParamsSchema = z.object({
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
const workflowScheduleRowSchema = z.object({
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
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type WorkflowScheduleRow = z.output<typeof workflowScheduleRowSchema>

/**
 * Workspace-scope listing extends the row with synthesized join fields.
 * Workflow-backed rows carry the workflow name/color from `workflow` (NOT NULL
 * columns); job-backed rows synthesize `null` server-side.
 */
const workspaceScheduleRowSchema = workflowScheduleRowSchema.extend({
  workflowName: z.string().nullable(),
  workflowColor: z.string().nullable(),
})

export type WorkspaceScheduleRow = z.output<typeof workspaceScheduleRowSchema>

const createScheduleBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  title: z.string().min(1, 'Title is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  cronExpression: z.string().min(1, 'Cron expression is required'),
  timezone: z.string().optional().default('UTC'),
  lifecycle: scheduleLifecycleSchema.optional().default('persistent'),
  maxRuns: z.number().optional(),
  startDate: z.string().optional(),
})

export type CreateScheduleBody = z.input<typeof createScheduleBodySchema>

const reactivateScheduleBodySchema = z.object({
  action: z.literal('reactivate'),
})

type ReactivateScheduleBody = z.input<typeof reactivateScheduleBodySchema>

const disableScheduleBodySchema = z.object({
  action: z.literal('disable'),
})

type DisableScheduleBody = z.input<typeof disableScheduleBodySchema>

const updateScheduleBodySchema = z.object({
  action: z.literal('update'),
  title: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  cronExpression: z.string().optional(),
  timezone: z.string().optional(),
  lifecycle: scheduleLifecycleSchema.optional(),
  maxRuns: z.number().nullable().optional(),
})

export type UpdateScheduleBody = z.input<typeof updateScheduleBodySchema>

const scheduleUpdateSchema = z.discriminatedUnion('action', [
  reactivateScheduleBodySchema,
  disableScheduleBodySchema,
  updateScheduleBodySchema,
])

type ScheduleUpdate = z.input<typeof scheduleUpdateSchema>

const messageResponseSchema = z.object({
  message: z.string(),
  nextRunAt: z.string().optional(),
})

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
 * Newly-created job schedules emit a partial summary with the canonical fields
 * the route synthesizes server-side; everything else is filled in on
 * subsequent reads.
 */
const createScheduleResponseSchema = z.object({
  schedule: z.object({
    id: z.string(),
    status: scheduleStatusSchema,
    cronExpression: z.string(),
    nextRunAt: z.string(),
  }),
})

type CreateScheduleResponse = z.output<typeof createScheduleResponseSchema>

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

export const deleteScheduleContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/schedules/[id]',
  params: scheduleIdParamsSchema,
  response: {
    mode: 'json',
    schema: messageResponseSchema,
  },
})
