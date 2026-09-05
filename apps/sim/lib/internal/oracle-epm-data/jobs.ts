import { getErrorMessage } from '@sim/utils/errors'
import { pollOracleEpmJob } from '@/lib/internal/oracle-epm'
import {
  oracleEpmDataEndpoints,
  oracleEpmDataJobSchema,
  oracleEpmDataStatusResponseSchema,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { OracleEpmDataAuthParams, OracleEpmDataJob } from '@/tools/oracle_epm_data/types'
import type { ToolResponse } from '@/tools/types'

/** Numeric status is authoritative; Oracle's batch example has contradictory jobStatus text. */
export function classifyOracleEpmDataJob(
  status: number
): 'pending' | 'success' | 'failure' | 'unknown' {
  if (status === -1 || status === 2) return 'pending'
  if (status === 0) return 'success'
  if (status === 1 || status === 3 || status === 4) return 'failure'
  return 'unknown'
}

function jobResult(job: OracleEpmDataJob & { httpStatus: number }): ToolResponse {
  const classification = classifyOracleEpmDataJob(job.status)
  const success = classification === 'pending' || classification === 'success'
  return {
    success,
    output: { ...job },
    ...(!success
      ? {
          retryable: false,
          error: `Oracle EPM job returned ${classification} status ${job.status}`,
        }
      : {}),
  }
}

/** Waits only after a documented submission, retaining the latest result without resubmission. */
export async function finishOracleEpmDataJob(
  auth: OracleEpmDataAuthParams,
  response: { status: number; data: unknown },
  waitForCompletion: boolean,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const envelope = oracleEpmDataStatusResponseSchema.parse(response.data)
  const parsed = oracleEpmDataJobSchema.safeParse(response.data)
  if (
    !parsed.success &&
    !['pending', 'success'].includes(classifyOracleEpmDataJob(envelope.status))
  ) {
    return {
      success: false,
      retryable: false,
      output: { httpStatus: response.status, ...envelope },
      error: `Oracle EPM job returned status ${envelope.status}`,
    }
  }
  let latest = { httpStatus: response.status, ...oracleEpmDataJobSchema.parse(response.data) }
  if (!waitForCompletion || classifyOracleEpmDataJob(latest.status) !== 'pending')
    return jobResult(latest)
  if (!/^[1-9]\d*$/.test(latest.jobId)) {
    return {
      success: false,
      retryable: false,
      output: latest,
      error: 'Oracle EPM did not return a usable job ID for polling',
    }
  }
  const jobId = latest.jobId
  try {
    const result = await pollOracleEpmJob<typeof latest, ToolResponse, ToolResponse>({
      signal,
      maxWaitMs: 300_000,
      cleanupReserveMs: 1_000,
      maxAttempts: 200,
      initialDelayMs: 2_000,
      maxDelayMs: 10_000,
      read: async (pollSignal) => {
        const current = await requestOracleEpmDataJson(auth, oracleEpmDataEndpoints.getJob, {
          pathParams: { jobId },
          signal: pollSignal,
        })
        const job = oracleEpmDataJobSchema.parse(current.data)
        if (job.jobId !== jobId)
          throw new Error('Oracle EPM returned a different job ID while polling')
        latest = { ...latest, ...job, httpStatus: current.status }
        return latest
      },
      classify: (job) => {
        const classification = classifyOracleEpmDataJob(job.status)
        if (classification === 'pending') return { state: 'pending' }
        if (classification === 'success') return { state: 'success', result: jobResult(job) }
        return { state: 'failure', error: jobResult(job) }
      },
    })
    return result.state === 'success' ? result.result : result.error
  } catch (error) {
    return {
      success: false,
      retryable: false,
      output: latest,
      error: `Oracle EPM job waiting stopped; use get_job_status with the returned jobId. ${getErrorMessage(error, 'Polling failed')}`,
    }
  }
}
