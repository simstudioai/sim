import { createLogger } from '@sim/logger'
import type { z } from 'zod'
import { getExecutionDeadlineAt } from '@/lib/core/execution-limits'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  openOracleEpmSourceFile,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm/files.server'
import { pollOracleEpmJob } from '@/lib/internal/oracle-epm/jobs'
import {
  PLANNING_DOWNLOAD_BYTES,
  PLANNING_INPUT_FILE_BYTES,
  PLANNING_UPLOAD_CHUNK_BYTES,
  planningEndpoints,
  planningLinkPolicies,
} from '@/lib/internal/oracle-epm-planning/route-space'
import {
  interopStatusSchema,
  PlanningContractError,
  PlanningInputError,
  type PlanningOperationContext,
  parsePlanningResponse,
  requireInteropSuccess,
} from '@/lib/internal/oracle-epm-planning/schema'
import { isUuid } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import type {
  OracleEpmPlanningDownloadFileParams,
  OracleEpmPlanningUploadFileParams,
} from '@/tools/oracle_epm_planning/types'

const logger = createLogger('OracleEpmPlanningFiles')
type InteropStatus = z.output<typeof interopStatusSchema>
const octetHeaders = { contentType: 'application/octet-stream' }

function findLink(status: InteropStatus, rel: string) {
  const links = status.links.filter((link) => link.rel === rel)
  if (links.length !== 1) throw new PlanningContractError()
  return links[0]
}

function interopClassification(status: InteropStatus) {
  if (status.status === -1) return { state: 'pending' } as const
  if (status.status === 0) return { state: 'success', result: status } as const
  return { state: 'failure', error: status } as const
}

/**
 * V1 upload: control requests deliberately use Oracle's documented chunkSize=14.
 * Data ranges are inclusive and chunk numbers start at 1.
 * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload_application_snapshot.html
 * The shared Java helper documents status=-1 polling and the standard "Job Status" relation:
 * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/common_helper_functions_for_java.html
 * The current v1 services/jobs route and standard relation are also documented at:
 * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_set_encryption_key.html
 */
export async function uploadPlanningFile(
  input: OracleEpmPlanningUploadFileParams,
  context: PlanningOperationContext
): Promise<{ fileName: string; size: number; status: number }> {
  const userId = context.runtime?.userId
  if (!userId) throw new PlanningInputError('Uploading requires an authenticated user')
  const source = await openOracleEpmSourceFile({
    file: input.file,
    userId,
    maxBytes: PLANNING_INPUT_FILE_BYTES,
    signal: context.signal,
  })
  const fileName = input.fileName ?? source.fileName
  const fileSize = String(input.file.size)
  const control = async (isFirst: boolean, isLast: boolean) =>
    parsePlanningResponse(
      interopStatusSchema,
      await context.client.request(planningEndpoints.uploadControl, {
        pathParams: { fileName },
        headers: octetHeaders,
        query: { q: JSON.stringify({ isFirst, isLast, chunkSize: 14, fileSize }) },
        signal: context.signal,
      })
    )
  requireInteropSuccess(await control(true, false))
  let bytes = 0
  let sent = 0
  let chunkNo = 1
  let buffered = 0
  let buffer = Buffer.allocUnsafe(Math.min(PLANNING_UPLOAD_CHUNK_BYTES, input.file.size))
  const send = async (chunk: Uint8Array) => {
    context.signal?.throwIfAborted()
    const status = parsePlanningResponse(
      interopStatusSchema,
      await context.client.request(planningEndpoints.uploadChunk, {
        pathParams: { fileName },
        headers: octetHeaders,
        query: {
          q: JSON.stringify({
            isFirst: false,
            isLast: false,
            chunkSize: chunk.byteLength,
            fileSize,
            startRange: String(sent),
            endRange: String(sent + chunk.byteLength - 1),
            chunkNo,
          }),
        },
        stream: chunk,
        signal: context.signal,
      })
    )
    requireInteropSuccess(status)
    sent += chunk.byteLength
    chunkNo++
  }
  for await (const chunk of source.chunks) {
    context.signal?.throwIfAborted()
    bytes += chunk.byteLength
    if (bytes > input.file.size)
      throw new PlanningInputError('Source file contains more bytes than its declared size')
    let position = 0
    while (position < chunk.byteLength) {
      const length = Math.min(buffer.length - buffered, chunk.byteLength - position)
      buffer.set(chunk.subarray(position, position + length), buffered)
      position += length
      buffered += length
      if (buffered === buffer.length) {
        await send(buffer)
        buffered = 0
        buffer = Buffer.allocUnsafe(Math.min(PLANNING_UPLOAD_CHUNK_BYTES, input.file.size - sent))
      }
    }
  }
  if (bytes !== input.file.size)
    throw new PlanningInputError('Source file contains fewer bytes than its declared size')
  if (buffered) await send(buffer.subarray(0, buffered))
  const completion = await control(false, true)
  if (completion.status === -1) {
    const link = context.client.validateReturnedLink(
      planningLinkPolicies.uploadStatus,
      findLink(completion, 'Job Status')
    )
    const result = await pollOracleEpmJob({
      read: async (signal) =>
        parsePlanningResponse(
          interopStatusSchema,
          await context.client.requestValidatedLink(link, signal)
        ),
      classify: interopClassification,
      signal: context.signal,
      maxWaitMs: (input.maxWaitSeconds ?? 300) * 1000,
      cleanupReserveMs: 0,
      maxAttempts: 1000,
      initialDelayMs: 1000,
      maxDelayMs: 10_000,
    })
    requireInteropSuccess(result.state === 'success' ? result.result : result.error)
  } else {
    requireInteropSuccess(completion)
  }
  /** There is no documented abort-upload operation; never delete an existing repository file on failure. */
  return { fileName, size: sent, status: 0 }
}

/**
 * V2 download uses POST initiation, GET status/data, DELETE temporary data.
 * Malformed example links are not repaired or allowed to weaken foundation policies.
 * https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/download_application_snapshot_v2.html
 */
export async function downloadPlanningFile(
  input: OracleEpmPlanningDownloadFileParams,
  context: PlanningOperationContext
): Promise<UserFile> {
  const runtime = context.runtime
  if (
    !runtime?.workspaceId ||
    !runtime.executionId ||
    !isUuid(runtime.workspaceId) ||
    !isUuid(runtime.workflowId) ||
    !isUuid(runtime.executionId)
  ) {
    throw new PlanningInputError('Downloading requires a valid workflow execution file context')
  }
  const executionContext = {
    workspaceId: runtime.workspaceId,
    workflowId: runtime.workflowId,
    executionId: runtime.executionId,
  }
  const maxWaitMs = (input.maxWaitSeconds ?? 300) * 1000
  const deadlineAt = new Date(
    Math.min(Date.now() + maxWaitMs, getExecutionDeadlineAt(context.signal)?.getTime() ?? Infinity)
  )
  let temporaryJobId: string | undefined
  let body: ReadableStream<Uint8Array> | undefined
  let operationFailed = true
  try {
    const initiation = parsePlanningResponse(
      interopStatusSchema,
      await context.client.request(planningEndpoints.startDownload, {
        json: { fileName: input.fileName },
        signal: context.signal,
      })
    )
    if (initiation.status !== -1 && initiation.status !== 0) requireInteropSuccess(initiation)
    const statusLink = findLink(initiation, 'Job Status')
    const validatedStatus = context.client.validateReturnedLink(
      planningLinkPolicies.downloadStatus,
      statusLink
    )
    /** Extract only after the foundation has checked the exact origin, gateway prefix and route. */
    temporaryJobId = new URL(statusLink.href).pathname.split('/').at(-1)!
    const result = await pollOracleEpmJob({
      read: async (signal) =>
        parsePlanningResponse(
          interopStatusSchema,
          await context.client.requestValidatedLink(validatedStatus, signal)
        ),
      classify: interopClassification,
      signal: context.signal,
      deadlineAt,
      maxWaitMs,
      cleanupReserveMs: Math.min(500, Math.floor(maxWaitMs / 10)),
      maxAttempts: 1000,
      initialDelayMs: 1000,
      maxDelayMs: 10_000,
    })
    const status = result.state === 'success' ? result.result : result.error
    requireInteropSuccess(status)
    const downloadLink = findLink(status, 'Download link')
    const validatedDownload = context.client.validateReturnedLink(
      planningLinkPolicies.download,
      downloadLink
    )
    if (new URL(downloadLink.href).pathname.split('/').at(-1) !== temporaryJobId)
      throw new PlanningContractError()
    const response = await context.client.requestValidatedLink(validatedDownload, context.signal)
    if (!('body' in response)) throw new PlanningContractError()
    body = response.body
    if (response.contentType?.split(';')[0].trim().toLowerCase() === 'application/json') {
      throw new PlanningInputError('Oracle returned an error instead of downloadable file content')
    }
    const file = await storeOracleEpmDownload({
      body,
      fileName: input.fileName,
      contentType: response.contentType,
      contentLength: response.contentLength,
      context: executionContext,
      maxBytes: PLANNING_DOWNLOAD_BYTES,
      signal: context.signal,
    })
    operationFailed = false
    return file
  } catch (error) {
    if (error instanceof PayloadSizeLimitError) {
      throw new PlanningInputError(
        'Oracle download exceeds the 100 MiB Sim output limit; keep the export in the Oracle repository'
      )
    }
    throw error
  } finally {
    if (body && !body.locked) await body.cancel().catch(() => undefined)
    if (temporaryJobId !== undefined) {
      try {
        const cleanup = parsePlanningResponse(
          interopStatusSchema,
          await context.client.request(planningEndpoints.cleanupDownload, {
            pathParams: { jobId: temporaryJobId },
            signal: AbortSignal.timeout(5000),
          })
        )
        requireInteropSuccess(cleanup)
      } catch {
        /** Preserve an earlier failure, and never include tenant identifiers or response bodies in logs. */
        logger.warn('Oracle temporary download cleanup failed')
        if (!operationFailed)
          throw new PlanningInputError(
            'File was stored, but Oracle temporary download cleanup failed'
          )
      }
    }
  }
}
