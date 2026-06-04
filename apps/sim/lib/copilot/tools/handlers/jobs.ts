import { db } from '@sim/db'
import { copilotChats, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import {
  performCompleteJob,
  performCreateJob,
  performDeleteJob,
  performUpdateJob,
} from '@/lib/workflows/schedules/orchestration'

const logger = createLogger('JobTools')

const ACTIVE_JOB_CONDITION = (workspaceId: string) =>
  and(
    eq(workflowSchedule.sourceWorkspaceId, workspaceId),
    eq(workflowSchedule.sourceType, 'job'),
    isNull(workflowSchedule.archivedAt)
  )

const JobLifecycleSchema = z.enum(['persistent', 'until_complete'])

const CreateJobParamsSchema = z
  .object({
    title: z.string().optional(),
    prompt: z.string().optional(),
    cron: z.string().optional(),
    time: z.string().optional(),
    timezone: z.string().optional(),
    lifecycle: JobLifecycleSchema.optional(),
    successCondition: z.string().optional(),
    maxRuns: z.number().optional(),
  })
  .passthrough()

const ManageJobArgsSchema = z
  .object({
    jobId: z.string().optional(),
    jobIds: z.array(z.string()).optional(),
    title: z.string().optional(),
    prompt: z.string().optional(),
    cron: z.string().optional(),
    time: z.string().optional(),
    timezone: z.string().optional(),
    status: z.string().optional(),
    lifecycle: z.string().optional(),
    successCondition: z.string().optional(),
    maxRuns: z.number().optional(),
  })
  .passthrough()

const ManageJobParamsSchema = z
  .object({
    operation: z.string().optional(),
    args: ManageJobArgsSchema.optional(),
  })
  .passthrough()

type CreateJobParams = z.infer<typeof CreateJobParamsSchema>
type ManageJobParams = z.infer<typeof ManageJobParamsSchema>

export async function executeCreateJob(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const parsedParams = CreateJobParamsSchema.safeParse(params)
  if (!parsedParams.success) {
    return { success: false, error: 'Invalid create job parameters' }
  }

  const rawParams: CreateJobParams = parsedParams.data
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
        error: toError(err).message,
      })
    }
  }

  try {
    const result = await performCreateJob({
      workspaceId: context.workspaceId,
      userId: context.userId,
      title,
      prompt,
      cronExpression: cron,
      time,
      timezone,
      lifecycle,
      successCondition,
      maxRuns,
      sourceChatId: context.chatId,
      sourceTaskName: taskName,
    })
    if (!result.success || !result.schedule) {
      return { success: false, error: result.error || 'Failed to create job' }
    }

    return {
      success: true,
      output: {
        jobId: result.schedule.id,
        title: result.schedule.jobTitle,
        schedule: result.humanReadable,
        nextRunAt: result.schedule.nextRunAt?.toISOString(),
        message: `Job created successfully. ${result.humanReadable}`,
      },
    }
  } catch (err) {
    logger.error('Failed to create job', {
      error: toError(err).message,
    })
    return { success: false, error: 'Failed to create job' }
  }
}

export async function executeManageJob(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const parsedParams = ManageJobParamsSchema.safeParse(params)
  if (!parsedParams.success) {
    return { success: false, error: 'Invalid manage job parameters' }
  }

  const rawParams: ManageJobParams = parsedParams.data
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
          error: toError(err).message,
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
          error: toError(err).message,
        })
        return { success: false, error: 'Failed to get job' }
      }
    }

    case 'update': {
      if (!args?.jobId) {
        return { success: false, error: 'jobId is required for update operation' }
      }

      try {
        const result = await performUpdateJob({
          jobId: args.jobId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          title: args.title,
          prompt: args.prompt,
          cronExpression: args.cron,
          time: args.time,
          timezone: args.timezone,
          status: args.status,
          lifecycle: args.lifecycle,
          successCondition: args.successCondition,
          maxRuns: args.maxRuns,
        })
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to update job' }
        }

        return {
          success: true,
          output: {
            jobId: args.jobId,
            updated: result.updatedFields || [],
            message: 'Job updated successfully',
          },
        }
      } catch (err) {
        logger.error('Failed to update job', {
          error: toError(err).message,
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
          const result = await performDeleteJob({
            jobId,
            workspaceId: context.workspaceId,
            userId: context.userId,
          })
          if (!result.success) {
            notFound.push(jobId)
            continue
          }
          deleted.push(jobId)
        }

        return {
          success: deleted.length > 0,
          output: { deleted, notFound },
        }
      } catch (err) {
        logger.error('Failed to delete job', {
          error: toError(err).message,
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
    if (!context.workspaceId) {
      return { success: false, error: 'Missing workspace context' }
    }

    const result = await performCompleteJob({
      jobId,
      workspaceId: context.workspaceId,
      userId: context.userId,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to complete job' }
    }
    if (result.alreadyCompleted) {
      return {
        success: true,
        output: { jobId, message: 'Job is already completed' },
      }
    }

    return {
      success: true,
      output: { jobId, message: 'Job marked as completed. No further executions will occur.' },
    }
  } catch (err) {
    logger.error('Failed to complete job', {
      error: toError(err).message,
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
      error: toError(err).message,
    })
    return { success: false, error: 'Failed to update job history' }
  }
}
