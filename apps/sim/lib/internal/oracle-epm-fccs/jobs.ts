import type { z } from 'zod'
import { type OracleEpmPollClassification, pollOracleEpmJob } from '@/lib/internal/oracle-epm'
import { type FccsContext, projectFccsResponse } from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsJobSchema, type fccsJobTypes } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { ToolResponse } from '@/tools/types'

export type FccsJob = z.output<typeof fccsJobSchema>
export type FccsJobType = (typeof fccsJobTypes)[number]

/** Status 2 means cancel-pending, not a terminal cancellation. Unknown codes are never success. */
export function classifyFccsJob(job: FccsJob): OracleEpmPollClassification<FccsJob, FccsJob> {
  if (job.status === -1 || job.status === 2) return { state: 'pending' as const }
  if (job.status === 0) return { state: 'success' as const, result: job }
  return { state: 'failure' as const, error: job }
}

export function fccsJobResult(job: FccsJob, attempts?: number): ToolResponse {
  const failed = classifyFccsJob(job).state === 'failure'
  return {
    success: !failed,
    output: { ...job, ...(attempts === undefined ? {} : { attempts }) },
    ...(failed
      ? {
          error: `Oracle EPM FCCS job ${job.jobId} returned status ${job.status}; inspect its details`,
        }
      : {}),
  }
}

/** execute_a_job.html: submit once; no retries of a potentially non-idempotent POST. */
export async function submitFccsJob(
  context: FccsContext,
  application: string,
  jobType: FccsJobType,
  jobName: string | undefined,
  parameters?: Record<string, unknown>
): Promise<ToolResponse> {
  const job = projectFccsResponse(
    fccsJobSchema,
    await context.client.request(fccsEndpoints.executeJob, {
      pathParams: { application },
      json: {
        jobType,
        ...(jobName === undefined ? {} : { jobName }),
        ...(parameters === undefined ? {} : { parameters }),
      },
      signal: context.signal,
    })
  )
  return fccsJobResult(job)
}

export async function readFccsJob(
  context: FccsContext,
  application: string,
  jobId: string,
  signal = context.signal
): Promise<FccsJob> {
  const job = projectFccsResponse(
    fccsJobSchema,
    await context.client.request(fccsEndpoints.getJob, {
      pathParams: { application, jobId },
      signal,
    })
  )
  if (BigInt(job.jobId) !== BigInt(jobId))
    throw new Error('Oracle EPM FCCS returned a different job ID')
  return job
}

export async function waitForFccsJob(
  context: FccsContext,
  application: string,
  jobId: string,
  maxWaitSeconds: number
): Promise<ToolResponse> {
  const result = await pollOracleEpmJob({
    read: (signal) => readFccsJob(context, application, jobId, signal),
    classify: classifyFccsJob,
    signal: context.signal,
    maxWaitMs: maxWaitSeconds * 1000,
    cleanupReserveMs: Math.min(1000, maxWaitSeconds * 100),
    maxAttempts: 10_000,
    initialDelayMs: 1000,
    maxDelayMs: 10_000,
  })
  return fccsJobResult(result.state === 'success' ? result.result : result.error, result.attempts)
}
