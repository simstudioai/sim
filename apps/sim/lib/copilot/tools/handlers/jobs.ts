import { db } from '@sim/db'
import { copilotChats, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { generateId } from '@/lib/core/utils/uuid'
import { parseCronToHumanReadable, validateCronExpression } from '@/lib/workflows/schedules/utils'

const logger = createLogger('JobTools')

const ACTIVE_JOB_CONDITION = (workspaceId: string) =>
  and(
    eq(workflowSchedule.sourceWorkspaceId, workspaceId),
    eq(workflowSchedule.sourceType, 'job'),
    isNull(workflowSchedule.archivedAt)
  )

interface CreateJobParams {
  title?: string
  prompt: string
  cron?: string
  time?: string
  timezone?: string
  lifecycle?: 'persistent' | 'until_complete'
  successCondition?: string
  maxRuns?: number
}

export async function executeCreateJob(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const rawParams = params as unknown as CreateJobParams
  const timezone = rawParams.timezone || context.userTimezone || 'UTC'
  const { title, prompt, cron, time, lifecycle, successCondition, maxRuns } = rawParams

  if (!prompt) {
    return { success: false, error: 'prompt is required' }
  }

  if (!cron && !time) {
    return { success: false, error: 'At least one of cron or time must be provided' }
  }

  if (!context.userId || !context.workspaceId) {
    return { success: false, error: 'Missing user or workspace context' }
  }

  let taskName: string | null = null
  if (context.chatId) {
    try {
      const [chat] = await db
        .select({ title: copilotChats.title })
        .from(copilotChats)
        .where(eq(copilotChats.id, context.chatId))
        .limit(1)
      taskName = chat?.title || null
    } catch (err) {
      logger.warn('Failed to look up chat title for job', {
        chatId: context.chatId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  let cronExpression: string | null = null
  let nextRunAt: Date | null = null

  if (cron) {
    const validation = validateCronExpression(cron, timezone)
    if (!validation.isValid) {
      return { success: false, error: `Invalid cron expression: ${validation.error}` }
    }
    cronExpression = cron
    nextRunAt = validation.nextRun!
  }

  if (time) {
    let timeStr = time
    const hasOffset = /[Zz]|[+-]\d{2}(:\d{2})?$/.test(timeStr)
    if (!hasOffset && timezone !== 'UTC') {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          timeZoneName: 'shortOffset',
        })
        const parts = formatter.formatToParts(new Date())
        const offsetPart = parts.find((p) => p.type === 'timeZoneName')
        if (offsetPart?.value) {
          const match = offsetPart.value.match(/GMT([+-]\d{1,2}(?::\d{2})?)/)
          if (match) {
            const raw = match[1]
            const [h, m] = raw.split(':')
            const offset = `${h.padStart(3, h.startsWith('-') ? '-' : '+')}:${m || '00'}`
            timeStr = `${timeStr}${offset}`
          }
        }
      } catch {
        // Fall through to parse as-is
      }
    }

    const parsed = new Date(timeStr)
    if (Number.isNaN(parsed.getTime())) {
      return { success: false, error: `Invalid time value: ${time}` }
    }

    if (!cron) {
      nextRunAt = parsed
    } else if (parsed > new Date()) {
      nextRunAt = parsed
    }
  }

  if (!nextRunAt) {
    return { success: false, error: 'Could not determine next run time' }
  }

  const jobId = generateId()
  const now = new Date()

  try {
    await db.insert(workflowSchedule).values({
      id: jobId,
      workflowId: null,
      cronExpression,
      nextRunAt,
      triggerType: 'schedule',
      timezone,
      sourceType: 'job',
      jobTitle: title || null,
      prompt,
      lifecycle: lifecycle || 'persistent',
      successCondition: successCondition || null,
      maxRuns: maxRuns ?? null,
      runCount: 0,
      sourceChatId: context.chatId || null,
      sourceTaskName: taskName,
      sourceUserId: context.userId,
      sourceWorkspaceId: context.workspaceId,
      status: 'active',
      failedCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    const humanReadable = cronExpression
      ? parseCronToHumanReadable(cronExpression, timezone)
      : `Once at ${nextRunAt.toISOString()}`

    logger.info('Job created', { jobId, cronExpression, nextRunAt: nextRunAt.toISOString() })

    recordAudit({
      workspaceId: context.workspaceId || null,
      actorId: context.userId,
      action: AuditAction.SCHEDULE_UPDATED,
      resourceType: AuditResourceType.SCHEDULE,
      resourceId: jobId,
      resourceName: title || undefined,
      description: `Created job "${title || jobId}"`,
      metadata: { operation: 'create', cronExpression },
    })

    return {
      success: true,
      output: {
        jobId,
        title: title || null,
        schedule: humanReadable,
        nextRunAt: nextRunAt.toISOString(),
        message: `Job created successfully. ${humanReadable}`,
      },
    }
  } catch (err) {
    logger.error('Failed to create job', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { success: false, error: 'Failed to create job' }
  }
}

interface ManageJobParams {
  operation: 'create' | 'list' | 'get' | 'update' | 'delete'
  args?: {
    jobId?: string
    jobIds?: string[]
    title?: string
    prompt?: string
    cron?: string
    time?: string
    timezone?: string
    status?: string
    lifecycle?: 'persistent' | 'until_complete'
    successCondition?: string
    maxRuns?: number
  }
}

export async function executeManageJob(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const rawParams = params as unknown as ManageJobParams
  const { operation, args } = rawParams

  if (!context.userId || !context.workspaceId) {
    return { success: false, error: 'Missing user or workspace context' }
  }

  switch (operation) {
    case 'create': {
      return executeCreateJob(
        {
          title: args?.title,
          prompt: args?.prompt,
          cron: args?.cron,
          time: args?.time,
          timezone: args?.timezone,
          lifecycle: args?.lifecycle,
          successCondition: args?.successCondition,
          maxRuns: args?.maxRuns,
        } as Record<string, unknown>,
        context
      )
    }

    case 'list': {
      try {
        const jobs = await db
          .select({
            id: workflowSchedule.id,
            jobTitle: workflowSchedule.jobTitle,
            prompt: workflowSchedule.prompt,
            cronExpression: workflowSchedule.cronExpression,
            timezone: workflowSchedule.timezone,
            status: workflowSchedule.status,
            lifecycle: workflowSchedule.lifecycle,
            successCondition: workflowSchedule.successCondition,
            maxRuns: workflowSchedule.maxRuns,
            runCount: workflowSchedule.runCount,
            nextRunAt: workflowSchedule.nextRunAt,
            lastRanAt: workflowSchedule.lastRanAt,
            sourceTaskName: workflowSchedule.sourceTaskName,
            createdAt: workflowSchedule.createdAt,
          })
          .from(workflowSchedule)
          .where(ACTIVE_JOB_CONDITION(context.workspaceId))

        return {
          success: true,
          output: {
            jobs: jobs.map((j) => ({
              id: j.id,
              title: j.jobTitle,
              prompt: j.prompt,
              cronExpression: j.cronExpression,
              timezone: j.timezone,
              status: j.status,
              lifecycle: j.lifecycle,
              successCondition: j.successCondition,
              maxRuns: j.maxRuns,
              runCount: j.runCount,
              nextRunAt: j.nextRunAt?.toISOString(),
              lastRanAt: j.lastRanAt?.toISOString(),
              sourceTaskName: j.sourceTaskName,
              createdAt: j.createdAt.toISOString(),
            })),
            count: jobs.length,
          },
        }
      } catch (err) {
        logger.error('Failed to list jobs', {
          error: err instanceof Error ? err.message : String(err),
        })
        return { success: false, error: 'Failed to list jobs' }
      }
    }

    case 'get': {
      if (!args?.jobId) {
        return { success: false, error: 'jobId is required for get operation' }
      }

      try {
        const [job] = await db
          .select()
          .from(workflowSchedule)
          .where(
            and(eq(workflowSchedule.id, args.jobId), ACTIVE_JOB_CONDITION(context.workspaceId))
          )
          .limit(1)

        if (!job) {
          return { success: false, error: `Job not found: ${args.jobId}` }
        }

        return {
          success: true,
          output: {
            id: job.id,
            title: job.jobTitle,
            prompt: job.prompt,
            cronExpression: job.cronExpression,
            timezone: job.timezone,
            status: job.status,
            lifecycle: job.lifecycle,
            successCondition: job.successCondition,
            maxRuns: job.maxRuns,
            runCount: job.runCount,
            nextRunAt: job.nextRunAt?.toISOString(),
            lastRanAt: job.lastRanAt?.toISOString(),
            sourceTaskName: job.sourceTaskName,
            sourceChatId: job.sourceChatId,
            createdAt: job.createdAt.toISOString(),
          },
        }
      } catch (err) {
        logger.error('Failed to get job', {
          error: err instanceof Error ? err.message : String(err),
        })
        return { success: false, error: 'Failed to get job' }
      }
    }

    case 'update': {
      if (!args?.jobId) {
        return { success: false, error: 'jobId is required for update operation' }
      }

      try {
        const [existing] = await db
          .select({ id: workflowSchedule.id })
          .from(workflowSchedule)
          .where(
            and(eq(workflowSchedule.id, args.jobId), ACTIVE_JOB_CONDITION(context.workspaceId))
          )
          .limit(1)

        if (!existing) {
          return { success: false, error: `Job not found: ${args.jobId}` }
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() }

        if (args.title !== undefined) {
          updates.jobTitle = args.title
        }

        if (args.prompt !== undefined) {
          updates.prompt = args.prompt
        }

        if (args.timezone !== undefined) {
          updates.timezone = args.timezone
        }

        if (args.status !== undefined) {
          if (!['active', 'paused'].includes(args.status)) {
            return { success: false, error: 'status must be "active" or "paused"' }
          }
          updates.status = args.status === 'paused' ? 'disabled' : args.status
        }

        if (args.cron !== undefined) {
          const tz = args.timezone || 'UTC'
          const validation = validateCronExpression(args.cron, tz)
          if (!validation.isValid) {
            return { success: false, error: `Invalid cron expression: ${validation.error}` }
          }
          updates.cronExpression = args.cron
          updates.nextRunAt = validation.nextRun!
        }

        if (args.lifecycle !== undefined) {
          if (!['persistent', 'until_complete'].includes(args.lifecycle)) {
            return { success: false, error: 'lifecycle must be "persistent" or "until_complete"' }
          }
          updates.lifecycle = args.lifecycle
        }

        if (args.successCondition !== undefined) {
          updates.successCondition = args.successCondition
        }

        if (args.maxRuns !== undefined) {
          updates.maxRuns = args.maxRuns
        }

        await db
          .update(workflowSchedule)
          .set(updates)
          .where(and(eq(workflowSchedule.id, args.jobId), isNull(workflowSchedule.archivedAt)))

        logger.info('Job updated', { jobId: args.jobId, fields: Object.keys(updates) })

        recordAudit({
          workspaceId: context.workspaceId || null,
          actorId: context.userId,
          action: AuditAction.SCHEDULE_UPDATED,
          resourceType: AuditResourceType.SCHEDULE,
          resourceId: args.jobId,
          description: `Updated job`,
          metadata: {
            operation: 'update',
            fields: Object.keys(updates).filter((k) => k !== 'updatedAt'),
          },
        })

        return {
          success: true,
          output: {
            jobId: args.jobId,
            updated: Object.keys(updates).filter((k) => k !== 'updatedAt'),
            message: 'Job updated successfully',
          },
        }
      } catch (err) {
        logger.error('Failed to update job', {
          error: err instanceof Error ? err.message : String(err),
        })
        return { success: false, error: 'Failed to update job' }
      }
    }

    case 'delete': {
      const jobIds = args?.jobIds ?? (args?.jobId ? [args.jobId] : [])
      if (jobIds.length === 0) {
        return { success: false, error: 'jobId or jobIds is required for delete operation' }
      }

      try {
        const deleted: string[] = []
        const notFound: string[] = []

        for (const jobId of jobIds) {
          const [existing] = await db
            .select({ id: workflowSchedule.id })
            .from(workflowSchedule)
            .where(and(eq(workflowSchedule.id, jobId), ACTIVE_JOB_CONDITION(context.workspaceId)))
            .limit(1)

          if (!existing) {
            notFound.push(jobId)
            continue
          }

          await db.delete(workflowSchedule).where(eq(workflowSchedule.id, jobId))
          deleted.push(jobId)

          logger.info('Job deleted', { jobId })

          recordAudit({
            workspaceId: context.workspaceId || null,
            actorId: context.userId,
            action: AuditAction.SCHEDULE_UPDATED,
            resourceType: AuditResourceType.SCHEDULE,
            resourceId: jobId,
            description: `Deleted job`,
            metadata: { operation: 'delete' },
          })
        }

        return {
          success: deleted.length > 0,
          output: { deleted, notFound },
        }
      } catch (err) {
        logger.error('Failed to delete job', {
          error: err instanceof Error ? err.message : String(err),
        })
        return { success: false, error: 'Failed to delete job' }
      }
    }

    default:
      return { success: false, error: `Unknown operation: ${operation}` }
  }
}

export async function executeCompleteJob(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { jobId } = params as { jobId?: string }

  if (!jobId) {
    return { success: false, error: 'jobId is required' }
  }

  try {
    const [job] = await db
      .select({
        id: workflowSchedule.id,
        status: workflowSchedule.status,
        sourceWorkspaceId: workflowSchedule.sourceWorkspaceId,
      })
      .from(workflowSchedule)
      .where(
        and(
          eq(workflowSchedule.id, jobId),
          eq(workflowSchedule.sourceType, 'job'),
          isNull(workflowSchedule.archivedAt)
        )
      )
      .limit(1)

    if (!job) {
      return { success: false, error: `Job not found: ${jobId}` }
    }

    if (context.workspaceId && job.sourceWorkspaceId !== context.workspaceId) {
      return { success: false, error: `Job not found: ${jobId}` }
    }

    if (job.status === 'completed') {
      return {
        success: true,
        output: { jobId, message: 'Job is already completed' },
      }
    }

    await db
      .update(workflowSchedule)
      .set({
        status: 'completed',
        nextRunAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(workflowSchedule.id, jobId), isNull(workflowSchedule.archivedAt)))

    logger.info('Job completed', { jobId })

    recordAudit({
      workspaceId: context.workspaceId || null,
      actorId: context.userId,
      action: AuditAction.SCHEDULE_UPDATED,
      resourceType: AuditResourceType.SCHEDULE,
      resourceId: jobId,
      description: `Completed job`,
      metadata: { operation: 'complete' },
    })

    return {
      success: true,
      output: { jobId, message: 'Job marked as completed. No further executions will occur.' },
    }
  } catch (err) {
    logger.error('Failed to complete job', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { success: false, error: 'Failed to complete job' }
  }
}

export async function executeUpdateJobHistory(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { jobId, summary } = params as { jobId?: string; summary?: string }

  if (!jobId || !summary) {
    return { success: false, error: 'jobId and summary are required' }
  }

  if (!context.workspaceId) {
    return { success: false, error: 'Missing workspace context' }
  }

  try {
    const [job] = await db
      .select({
        id: workflowSchedule.id,
        jobHistory: workflowSchedule.jobHistory,
      })
      .from(workflowSchedule)
      .where(and(eq(workflowSchedule.id, jobId), ACTIVE_JOB_CONDITION(context.workspaceId)))
      .limit(1)

    if (!job) {
      return { success: false, error: `Job not found: ${jobId}` }
    }

    const existing = (job.jobHistory || []) as Array<{ timestamp: string; summary: string }>
    const updated = [...existing, { timestamp: new Date().toISOString(), summary }].slice(-50)

    await db
      .update(workflowSchedule)
      .set({ jobHistory: updated, updatedAt: new Date() })
      .where(and(eq(workflowSchedule.id, jobId), isNull(workflowSchedule.archivedAt)))

    logger.info('Job history updated', { jobId, entryCount: updated.length })

    return {
      success: true,
      output: { jobId, entryCount: updated.length, message: 'History entry recorded.' },
    }
  } catch (err) {
    logger.error('Failed to update job history', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { success: false, error: 'Failed to update job history' }
  }
}
