import { z } from 'zod'
import { OracleEpmError, pollOracleEpmJob } from '@/lib/internal/oracle-epm'
import {
  normalizeOraclePcmTask,
  OraclePcmOperationError,
  pcmName,
} from '@/lib/internal/oracle-epm-profitability/normalizers'
import {
  oraclePcmClient,
  parseOraclePcmInput,
  pcmAuthSchema,
  pcmNumber,
  pcmTaskEndpoint,
  requestOraclePcmJson,
} from '@/lib/internal/oracle-epm-profitability/operations'
import type { OraclePcmResponse, OraclePcmTask } from '@/tools/oracle_epm_profitability/types'

export async function executeOraclePcmJobOperation(
  operation: string,
  input: unknown,
  signal?: AbortSignal
): Promise<OraclePcmResponse> {
  const params = parseOraclePcmInput(
    pcmAuthSchema.extend({
      processName: pcmName,
      maxWaitSeconds: pcmNumber(1, 3_600, 300).pipe(z.number().int()),
    }),
    input
  )
  const client = oraclePcmClient(params)
  const read = async (readSignal?: AbortSignal) =>
    normalizeOraclePcmTask(
      await requestOraclePcmJson(client, pcmTaskEndpoint, {
        pathParams: { processName: params.processName },
        signal: readSignal,
      }),
      params.processName
    )
  if (operation === 'get_task_status') return { success: true, output: await read(signal) }
  if (operation !== 'wait_for_task')
    throw new OraclePcmOperationError('Unsupported Oracle PCM task operation')
  let lastTask: OraclePcmTask | undefined
  try {
    const result = await pollOracleEpmJob<OraclePcmTask, OraclePcmTask, OraclePcmTask>({
      read: async (pollSignal) => {
        lastTask = await read(pollSignal)
        return lastTask
      },
      classify: (task) =>
        task.state === 'pending'
          ? { state: 'pending' }
          : task.state === 'succeeded'
            ? { state: 'success', result: task }
            : { state: 'failure', error: task },
      signal,
      maxWaitMs: (params.maxWaitSeconds ?? 300) * 1_000,
      cleanupReserveMs: 100,
      maxAttempts: 1_000,
      initialDelayMs: 1_000,
      maxDelayMs: 10_000,
    })
    return {
      success: result.state === 'success',
      output: {
        ...(result.state === 'success' ? result.result : result.error),
        attempts: result.attempts,
        timedOut: false,
      },
      retryable: false,
      ...(result.state === 'failure'
        ? { error: 'Oracle PCM task failed; it was not resubmitted' }
        : {}),
    }
  } catch (error) {
    signal?.throwIfAborted()
    const timedOut =
      (error instanceof Error && error.name === 'TimeoutError') ||
      (error instanceof OracleEpmError && error.category === 'timeout')
    if (!timedOut) throw error
    return {
      success: false,
      output: { ...lastTask, processName: params.processName, timedOut: true },
      error:
        'Oracle PCM wait timed out; the remote task was not cancelled. Resume with the same processName.',
      retryable: false,
    }
  }
}
