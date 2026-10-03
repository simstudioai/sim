import type { OracleEpmEndpoint } from '@/lib/internal/oracle-epm'
import { OracleEpmError, pollOracleEpmJob } from '@/lib/internal/oracle-epm'
import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import {
  requireEdmDownloadContext,
  storeEdmFile,
} from '@/lib/internal/oracle-epm-enterprise-data-management/files'
import {
  edmDownloadLink,
  edmJobLink,
} from '@/lib/internal/oracle-epm-enterprise-data-management/links'
import {
  edmJobResultSchema,
  edmJobSchema,
} from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import {
  type EdmAsyncOutput,
  type EdmJob,
  type EdmOperationContext,
  EdmOperationError,
  edmJsonData,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export async function readEdmJob(jobRunId: string, context: EdmOperationContext) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.job, {
      pathParams: { jobRunId },
      signal: context.signal,
    })
  )
  return edmJobSchema.parse(data)
}

export async function readEdmJobResult(jobRunId: string, context: EdmOperationContext) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.jobResult, {
      pathParams: { jobRunId },
      signal: context.signal,
    })
  )
  return edmJobResultSchema.parse(data)
}

/** Local cancellation stops waiting; it does not claim to cancel the remote Oracle job. */
export async function waitForEdmJob(
  jobId: string,
  options: { waitForCompletion: boolean; maxWaitSeconds: number },
  context: EdmOperationContext
): Promise<EdmAsyncOutput> {
  if (!options.waitForCompletion) return { jobId, job: null, completed: false, timedOut: false }
  let latest: EdmJob | null = null
  try {
    const outcome = await pollOracleEpmJob<EdmJob, EdmJob, EdmJob>({
      read: async (signal) => {
        latest = await readEdmJob(jobId, { ...context, signal })
        return latest
      },
      classify: (job) => {
        if (job.status === 'COMPLETED') return { state: 'success', result: job }
        if (job.status === 'ERROR') return { state: 'failure', error: job }
        return { state: 'pending' }
      },
      signal: context.signal,
      maxWaitMs: options.maxWaitSeconds * 1000,
      cleanupReserveMs: 100,
      maxAttempts: 1000,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
    })
    const job = outcome.state === 'success' ? outcome.result : outcome.error
    return { jobId, job, completed: job.status === 'COMPLETED', timedOut: false }
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { jobId, job: latest, completed: false, timedOut: true }
    }
    throw new EdmOperationError(
      'Oracle EDM status retrieval failed; resume with the returned job ID',
      error instanceof OracleEpmError ? (error.status ?? 502) : 502,
      { jobId, job: latest, completed: false, timedOut: false }
    )
  }
}

export async function startEdmJob(
  endpoint: OracleEpmEndpoint,
  body: Record<string, unknown>,
  options: { waitForCompletion: boolean; maxWaitSeconds: number },
  context: EdmOperationContext,
  pathParams?: Record<string, string>,
  outputFileName?: string
): Promise<EdmAsyncOutput> {
  if (outputFileName && options.waitForCompletion) requireEdmDownloadContext(context)
  const response = edmJsonData(
    await context.client.request(endpoint, {
      pathParams,
      json: body,
      signal: context.signal,
    })
  )
  const { id } = edmJobLink(context.client, response)
  let output: EdmAsyncOutput = { jobId: id, job: null, completed: false, timedOut: false }
  if (outputFileName) output.fileName = outputFileName
  try {
    output = { ...output, ...(await waitForEdmJob(id, options, context)) }
    if (!output.completed) return output
    output.result = await readEdmJobResult(id, context)
    if (outputFileName) {
      const linkedFile = output.job ? edmDownloadLink(context.client, output.job) : null
      const response = linkedFile
        ? await context.client.requestValidatedLink(linkedFile.handle, context.signal)
        : await context.client.request(edmEndpoints.stagingFile, {
            pathParams: { fileName: outputFileName },
            signal: context.signal,
          })
      output.file = await storeEdmFile(response, outputFileName, context)
    }
    return output
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof EdmOperationError && error.output) output = { ...output, ...error.output }
    throw new EdmOperationError(
      'Oracle EDM accepted the job but follow-up failed; resume with the returned job ID',
      error instanceof OracleEpmError || error instanceof EdmOperationError
        ? (error.status ?? 502)
        : 502,
      output
    )
  }
}

export async function downloadEdmJobResult(
  jobRunId: string,
  fileName: string | undefined,
  context: EdmOperationContext
) {
  requireEdmDownloadContext(context)
  const job = await readEdmJob(jobRunId, context)
  if (job.status !== 'COMPLETED')
    throw new EdmOperationError('The EDM job must complete before downloading its file')
  const link = edmDownloadLink(context.client, job)
  if (!link && !fileName)
    throw new EdmOperationError(
      'Provide the original staging file name for a job without an advertised file link'
    )
  const result = await readEdmJobResult(jobRunId, context)
  const response = link
    ? await context.client.requestValidatedLink(link.handle, context.signal)
    : await context.client.request(edmEndpoints.stagingFile, {
        pathParams: { fileName: fileName! },
        signal: context.signal,
      })
  return { job, result, file: await storeEdmFile(response, fileName ?? link!.fileName, context) }
}
