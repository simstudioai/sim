import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { captureServerEvent } from '@/lib/posthog/server'
import { parseCronToHumanReadable, validateCronExpression } from '@/lib/workflows/schedules/utils'

const logger = createLogger('ScheduleOrchestration')

type ScheduleErrorCode = 'not_found' | 'validation' | 'internal'

interface ActorMetadata {
  actorName?: string | null
  actorEmail?: string | null
  request?: NextRequest
}

export interface PerformCreateJobParams extends ActorMetadata {
  workspaceId: string
  userId: string
  title?: string | null
  prompt: string
  cronExpression?: string | null
  time?: string | null
  timezone: string
  lifecycle?: 'persistent' | 'until_complete'
  successCondition?: string | null
  maxRuns?: number | null
  startDate?: string | null
  sourceChatId?: string | null
  sourceTaskName?: string | null
}

export interface PerformScheduleResult {
  success: boolean
  error?: string
  errorCode?: ScheduleErrorCode
  schedule?: typeof workflowSchedule.$inferSelect
  humanReadable?: string
  updatedFields?: string[]
  alreadyCompleted?: boolean
}

export interface PerformUpdateJobParams extends ActorMetadata {
  jobId: string
  workspaceId: string
  userId: string
  title?: string
  prompt?: string
  cronExpression?: string
  time?: string | null
  timezone?: string
  status?: string
  lifecycle?: string
  successCondition?: string | null
  maxRuns?: number | null
}

export interface PerformDeleteJobParams extends ActorMetadata {
  jobId: string
  workspaceId: string
  userId: string
}

export interface PerformCompleteJobParams extends ActorMetadata {
  jobId: string
  workspaceId: string
  userId: string
}

const activeJobCondition = (jobId: string, workspaceId: string) =>
  and(
    eq(workflowSchedule.id, jobId),
    eq(workflowSchedule.sourceWorkspaceId, workspaceId),
    eq(workflowSchedule.sourceType, 'job'),
    isNull(workflowSchedule.archivedAt)
  )

function parseOneTimeRun(time: string, timezone: string): Date | null {
  let timeStr = time
  const hasOffset = /[Zz]|[+-]\d{2}(:\d{2})?$/.test(timeStr)
  if (!hasOffset && timezone !== 'UTC') {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset',
      })
      const parts = formatter.formatToParts(new Date())
      const offsetPart = parts.find((part) => part.type === 'timeZoneName')
      const match = offsetPart?.value.match(/GMT([+-]\d{1,2}(?::\d{2})?)/)
      if (match) {
        const [rawHours, rawMinutes = '00'] = match[1].split(':')
        const sign = rawHours.startsWith('-') ? '-' : '+'
        const hour = Number(rawHours.replace(/^[+-]/, ''))
        if (Number.isFinite(hour)) {
          const offset = `${sign}${String(hour).padStart(2, '0')}:${rawMinutes.padStart(2, '0')}`
          timeStr = `${timeStr}${offset}`
        }
      }
    } catch {}
  }

  const parsed = new Date(timeStr)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function performCreateJob(
  params: PerformCreateJobParams
): Promise<PerformScheduleResult> {
  if (!params.prompt.trim()) {
    return { success: false, error: 'prompt is required', errorCode: 'validation' }
  }

  const cronExpression = params.cronExpression || null
  if (!cronExpression && !params.time) {
    return {
      success: false,
      error: 'At least one of cronExpression or time must be provided',
      errorCode: 'validation',
    }
  }

  let nextRunAt: Date | null = null
  if (cronExpression) {
    const validation = validateCronExpression(cronExpression, params.timezone)
    if (!validation.isValid || !validation.nextRun) {
      return {
        success: false,
        error: validation.error || 'Invalid cron expression',
        errorCode: 'validation',
      }
    }
    nextRunAt = validation.nextRun
  }

  if (params.time) {
    const parsed = parseOneTimeRun(params.time, params.timezone)
    if (!parsed) {
      return {
        success: false,
        error: `Invalid time value: ${params.time}`,
        errorCode: 'validation',
      }
    }
    if (!cronExpression || parsed > new Date()) nextRunAt = parsed
  }

  if (params.startDate) {
    const start = new Date(params.startDate)
    if (start > new Date()) nextRunAt = start
  }

  if (!nextRunAt) {
    return { success: false, error: 'Could not determine next run time', errorCode: 'validation' }
  }

  try {
    const id = generateId()
    const now = new Date()
    await db.insert(workflowSchedule).values({
      id,
      workflowId: null,
      cronExpression,
      triggerType: 'schedule',
      sourceType: 'job',
      status: 'active',
      timezone: params.timezone,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
      failedCount: 0,
      jobTitle: params.title?.trim() || null,
      prompt: params.prompt.trim(),
      lifecycle: params.lifecycle || 'persistent',
      successCondition: params.successCondition || null,
      maxRuns: params.maxRuns ?? null,
      runCount: 0,
      sourceChatId: params.sourceChatId || null,
      sourceTaskName: params.sourceTaskName || null,
      sourceUserId: params.userId,
      sourceWorkspaceId: params.workspaceId,
    })

    const [schedule] = await db
      .select()
      .from(workflowSchedule)
      .where(eq(workflowSchedule.id, id))
      .limit(1)

    const humanReadable = cronExpression
      ? parseCronToHumanReadable(cronExpression, params.timezone)
      : `Once at ${nextRunAt.toISOString()}`

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.SCHEDULE_CREATED,
      resourceType: AuditResourceType.SCHEDULE,
      resourceId: id,
      resourceName: params.title?.trim() || undefined,
      description: `Created job schedule "${params.title?.trim() || id}"`,
      metadata: {
        cronExpression,
        timezone: params.timezone,
        lifecycle: params.lifecycle || 'persistent',
        maxRuns: params.maxRuns ?? null,
      },
      request: params.request,
    })

    captureServerEvent(
      params.userId,
      'scheduled_task_created',
      { workspace_id: params.workspaceId },
      { groups: { workspace: params.workspaceId } }
    )

    return { success: true, schedule, humanReadable }
  } catch (error) {
    logger.error('Failed to create job', { error: toError(error).message })
    return { success: false, error: 'Failed to create job', errorCode: 'internal' }
  }
}

export async function performUpdateJob(
  params: PerformUpdateJobParams
): Promise<PerformScheduleResult> {
  try {
    const [job] = await db
      .select()
      .from(workflowSchedule)
      .where(activeJobCondition(params.jobId, params.workspaceId))
      .limit(1)

    if (!job)
      return { success: false, error: `Job not found: ${params.jobId}`, errorCode: 'not_found' }

    const updates: Partial<typeof workflowSchedule.$inferInsert> = { updatedAt: new Date() }
    if (params.title !== undefined) updates.jobTitle = params.title.trim()
    if (params.prompt !== undefined) updates.prompt = params.prompt.trim()
    if (params.timezone !== undefined) updates.timezone = params.timezone
    if (params.status !== undefined) {
      if (!['active', 'paused', 'disabled'].includes(params.status)) {
        return {
          success: false,
          error: 'status must be "active" or "paused"',
          errorCode: 'validation',
        }
      }
      updates.status = params.status === 'paused' ? 'disabled' : params.status
    }
    if (params.lifecycle !== undefined) {
      if (params.lifecycle !== 'persistent' && params.lifecycle !== 'until_complete') {
        return {
          success: false,
          error: 'lifecycle must be "persistent" or "until_complete"',
          errorCode: 'validation',
        }
      }
      updates.lifecycle = params.lifecycle
      if (params.lifecycle === 'persistent') updates.maxRuns = null
    }
    if (params.successCondition !== undefined) updates.successCondition = params.successCondition
    if (params.maxRuns !== undefined) updates.maxRuns = params.maxRuns
    const effectiveStatus = updates.status ?? job.status

    if (params.cronExpression !== undefined) {
      const timezone = params.timezone || job.timezone || 'UTC'
      const validation = validateCronExpression(params.cronExpression, timezone)
      if (!validation.isValid || !validation.nextRun) {
        return {
          success: false,
          error: validation.error || 'Invalid cron expression',
          errorCode: 'validation',
        }
      }
      updates.cronExpression = params.cronExpression
      if (effectiveStatus === 'active') updates.nextRunAt = validation.nextRun
    }
    if (params.time !== undefined && params.time !== null) {
      const timezone = params.timezone || job.timezone || 'UTC'
      const parsed = parseOneTimeRun(params.time, timezone)
      if (!parsed) {
        return {
          success: false,
          error: `Invalid time value: ${params.time}`,
          errorCode: 'validation',
        }
      }
      const cronExpression =
        params.cronExpression !== undefined ? params.cronExpression : job.cronExpression
      if (effectiveStatus === 'active' && (!cronExpression || parsed > new Date())) {
        updates.nextRunAt = parsed
      }
    }

    const updatedFields = Object.keys(updates).filter((key) => key !== 'updatedAt')

    await db
      .update(workflowSchedule)
      .set(updates)
      .where(and(eq(workflowSchedule.id, params.jobId), isNull(workflowSchedule.archivedAt)))

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.SCHEDULE_UPDATED,
      resourceType: AuditResourceType.SCHEDULE,
      resourceId: params.jobId,
      resourceName: job.jobTitle ?? undefined,
      description: `Updated job schedule "${job.jobTitle ?? params.jobId}"`,
      metadata: { operation: 'update', updatedFields },
      request: params.request,
    })

    return { success: true, updatedFields }
  } catch (error) {
    logger.error('Failed to update job', { error: toError(error).message })
    return { success: false, error: 'Failed to update job', errorCode: 'internal' }
  }
}

export async function performDeleteJob(
  params: PerformDeleteJobParams
): Promise<PerformScheduleResult> {
  const [job] = await db
    .select()
    .from(workflowSchedule)
    .where(activeJobCondition(params.jobId, params.workspaceId))
    .limit(1)

  if (!job)
    return { success: false, error: `Job not found: ${params.jobId}`, errorCode: 'not_found' }

  await db.delete(workflowSchedule).where(eq(workflowSchedule.id, params.jobId))
  recordAudit({
    workspaceId: params.workspaceId,
    actorId: params.userId,
    actorName: params.actorName ?? undefined,
    actorEmail: params.actorEmail ?? undefined,
    action: AuditAction.SCHEDULE_DELETED,
    resourceType: AuditResourceType.SCHEDULE,
    resourceId: params.jobId,
    resourceName: job.jobTitle ?? undefined,
    description: `Deleted job "${job.jobTitle ?? params.jobId}"`,
    metadata: {
      sourceType: job.sourceType,
      cronExpression: job.cronExpression,
      timezone: job.timezone,
    },
    request: params.request,
  })

  captureServerEvent(
    params.userId,
    'scheduled_task_deleted',
    { workspace_id: params.workspaceId },
    { groups: { workspace: params.workspaceId } }
  )

  return { success: true, schedule: job }
}

export async function performCompleteJob(
  params: PerformCompleteJobParams
): Promise<PerformScheduleResult> {
  const [job] = await db
    .select()
    .from(workflowSchedule)
    .where(activeJobCondition(params.jobId, params.workspaceId))
    .limit(1)

  if (!job)
    return { success: false, error: `Job not found: ${params.jobId}`, errorCode: 'not_found' }
  if (job.status === 'completed') return { success: true, schedule: job, alreadyCompleted: true }

  const [updatedJob] = await db
    .update(workflowSchedule)
    .set({ status: 'completed', nextRunAt: null, updatedAt: new Date() })
    .where(and(eq(workflowSchedule.id, params.jobId), isNull(workflowSchedule.archivedAt)))
    .returning()

  recordAudit({
    workspaceId: params.workspaceId,
    actorId: params.userId,
    actorName: params.actorName ?? undefined,
    actorEmail: params.actorEmail ?? undefined,
    action: AuditAction.SCHEDULE_UPDATED,
    resourceType: AuditResourceType.SCHEDULE,
    resourceId: params.jobId,
    description: 'Completed job',
    metadata: { operation: 'complete' },
    request: params.request,
  })

  return { success: true, schedule: updatedJob, alreadyCompleted: false }
}
