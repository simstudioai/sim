import { getExecutionDeadlineAt } from '@/lib/core/execution-limits'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { OracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import {
  openOracleEpmSourceFile,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm/files.server'
import { pollOracleEpmJob } from '@/lib/internal/oracle-epm/jobs'
import { projectJob, readJobLink } from '@/lib/internal/oracle-epm-platform/jobs'
import type { OracleEpmPlatformOperationContext } from '@/lib/internal/oracle-epm-platform/operations'
import {
  filesSchema,
  jsonBody,
  OracleEpmPlatformResponseError,
  OracleEpmPlatformStatusError,
  parseResponse,
  readStatus,
  requireSuccess,
  statusOutput,
} from '@/lib/internal/oracle-epm-platform/responses'
import {
  DOWNLOAD_FILE_LIMIT,
  deleteTemporaryDownloadEndpoint,
  downloadLinkPolicy,
  endpoints,
  jobLinkPolicies,
  REPOSITORY_FILE_LIMIT,
  SNAPSHOT_CHUNK_LIMIT,
  SNAPSHOT_FILE_LIMIT,
} from '@/lib/internal/oracle-epm-platform/routes'
import type { OracleEpmPlatformInput } from '@/lib/internal/oracle-epm-platform/schemas'
import type { UserFile } from '@/executor/types'
import type {
  OracleEpmPlatformOutputMap,
  OracleEpmRepositoryFile,
} from '@/tools/oracle_epm_platform/types'

export class OracleEpmPlatformFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OracleEpmPlatformFileError'
  }
}

function requireFileUser(context: OracleEpmPlatformOperationContext): string {
  if (!context.execution?.userId)
    throw new OracleEpmPlatformFileError('File operations require an authenticated execution')
  return context.execution.userId
}
function requireSourceSize(file: UserFile, limit: number): void {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limit) {
    throw new OracleEpmPlatformFileError(
      limit === SNAPSHOT_FILE_LIMIT
        ? 'Snapshot source size must be valid and no larger than 5 GiB'
        : 'Repository source size must be valid and no larger than 100 MiB'
    )
  }
}

/** Re-chunk an authorized stream; never materialize an entire snapshot. */
export async function* verifiedChunks(
  source: AsyncIterable<Uint8Array>,
  declaredSize: number,
  chunkLimit: number,
  signal?: AbortSignal
): AsyncIterable<Buffer> {
  let received = 0
  let buffered = 0
  let chunk = Buffer.alloc(Math.min(chunkLimit, declaredSize))
  for await (const input of source) {
    signal?.throwIfAborted()
    if (received + input.byteLength > declaredSize) {
      throw new OracleEpmPlatformFileError('Source file bytes exceed the declared file size')
    }
    received += input.byteLength
    let offset = 0
    while (offset < input.byteLength) {
      const count = Math.min(chunk.length - buffered, input.byteLength - offset)
      chunk.set(input.subarray(offset, offset + count), buffered)
      buffered += count
      offset += count
      if (buffered === chunk.length) {
        yield chunk
        signal?.throwIfAborted()
        chunk = Buffer.alloc(chunkLimit)
        buffered = 0
      }
    }
  }
  signal?.throwIfAborted()
  if (received !== declaredSize) {
    throw new OracleEpmPlatformFileError('Source file bytes do not match the declared file size')
  }
  if (buffered) yield chunk.subarray(0, buffered)
}

function cleanupSignal(parent?: AbortSignal): AbortSignal | undefined {
  const deadline = getExecutionDeadlineAt(parent)?.getTime()
  const remaining = deadline === undefined ? 5000 : Math.min(5000, deadline - Date.now())
  return remaining > 0 ? AbortSignal.timeout(remaining) : undefined
}

/** Best effort cleanup is bounded and never retries a state-changing request. */
async function cleanupOwned(
  run: (signal: AbortSignal) => Promise<unknown>,
  parent?: AbortSignal
): Promise<boolean> {
  const signal = cleanupSignal(parent)
  if (!signal) return false
  try {
    await run(signal)
    return true
  } catch {
    return false
  }
}

export async function listRepositoryFiles(
  client: OracleEpmClient,
  signal?: AbortSignal
): Promise<OracleEpmRepositoryFile[]> {
  const value = jsonBody(await client.request(endpoints.list_files, { signal }))
  requireSuccess(value)
  return parseResponse(filesSchema, value).items
}

export async function uploadRepositoryFile(
  input: OracleEpmPlatformInput<'upload_repository_file'>,
  context: OracleEpmPlatformOperationContext
): Promise<OracleEpmPlatformOutputMap['upload_repository_file']> {
  const { client, signal } = context
  const userId = requireFileUser(context)
  requireSourceSize(input.file, REPOSITORY_FILE_LIMIT)
  const source = await openOracleEpmSourceFile({
    file: input.file,
    userId,
    maxBytes: REPOSITORY_FILE_LIMIT,
    signal,
  })
  // Generic uploads are bounded to 100 MiB and use the documented single-request API.
  const bytes = Buffer.alloc(input.file.size)
  let offset = 0
  for await (const chunk of verifiedChunks(
    source.chunks,
    input.file.size,
    SNAPSHOT_CHUNK_LIMIT,
    signal
  )) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  const value = jsonBody(
    await client.request(endpoints.upload_repository_file, {
      pathParams: { fileName: input.fileName },
      query: { extDirPath: input.directory },
      stream: bytes,
      signal,
    })
  )
  // The upload reference also permits asynchronous extraction of an LCM artifact.
  return {
    ...projectJob(client, value, 'snapshot_upload'),
    fileName: input.fileName,
    bytesUploaded: offset,
  }
}

export async function uploadSnapshot(
  input: OracleEpmPlatformInput<'upload_snapshot'>,
  context: OracleEpmPlatformOperationContext
): Promise<OracleEpmPlatformOutputMap['upload_snapshot']> {
  const { client, signal } = context
  const userId = requireFileUser(context)
  requireSourceSize(input.file, SNAPSHOT_FILE_LIMIT)
  if (input.file.size === 0)
    throw new OracleEpmPlatformFileError('Snapshot ZIP files cannot be empty')
  const source = await openOracleEpmSourceFile({
    file: input.file,
    userId,
    maxBytes: SNAPSHOT_FILE_LIMIT,
    signal,
  })
  const fileSize = String(input.file.size)
  const send = async (
    q: Record<string, string | number | boolean>,
    stream: Uint8Array = Buffer.alloc(0)
  ) =>
    jsonBody(
      await client.request(endpoints.upload_snapshot, {
        pathParams: { snapshotName: input.snapshotName },
        query: { q: JSON.stringify(q) },
        stream,
        signal,
      })
    )

  let owned = false
  let finalizing = false
  try {
    // Oracle's v1 init/finalize control messages specify chunkSize=14 with an empty body.
    // https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload_application_snapshot.html
    requireSuccess(await send({ isFirst: true, chunkSize: 14, fileSize, isLast: false }))
    owned = true
    let offset = 0
    let chunkNo = 1
    for await (const chunk of verifiedChunks(
      source.chunks,
      input.file.size,
      SNAPSHOT_CHUNK_LIMIT,
      signal
    )) {
      // Zero-based inclusive ranges; chunk numbering begins at 1 (Oracle's November 2025 example).
      // https://docs.oracle.com/en/cloud/saas/epm-cloud/prest/GUID-185E11F9-8420-414A-B2EA-9098767FC24F.pdf
      requireSuccess(
        await send(
          {
            startRange: String(offset),
            endRange: String(offset + chunk.length - 1),
            isFirst: false,
            isLast: false,
            fileSize,
            chunkSize: chunk.length,
            chunkNo,
          },
          chunk
        )
      )
      offset += chunk.length
      chunkNo += 1
    }
    finalizing = true
    const value = await send({ isFirst: false, chunkSize: 14, fileSize, isLast: true })
    return {
      ...projectJob(client, value, 'snapshot_upload'),
      snapshotName: input.snapshotName,
      bytesUploaded: offset,
    }
  } catch (error) {
    // Successful initialization establishes ownership. A conflict/ambiguous init never does.
    // Once extraction may have started, retain the upload for inspection instead of deleting it.
    if (owned && !finalizing) {
      const cleaned = await cleanupOwned(
        async (cleanup) =>
          requireSuccess(
            jsonBody(
              await client.request(endpoints.delete_file, {
                json: { fileName: input.snapshotName },
                signal: cleanup,
              })
            )
          ),
        signal
      )
      if (!cleaned) {
        throw new OracleEpmPlatformFileError(
          'Snapshot upload failed; its incomplete operation-owned file could not be cleaned up. Inspect the repository before retrying'
        )
      }
    }
    throw error
  }
}

export async function downloadRepositoryFile(
  input: OracleEpmPlatformInput<'download_file'>,
  context: OracleEpmPlatformOperationContext
): Promise<OracleEpmPlatformOutputMap['download_file']> {
  const { client, signal, execution } = context
  requireFileUser(context)
  if (!execution?.workspaceId || !execution.workflowId || !execution.executionId) {
    throw new OracleEpmPlatformFileError(
      'Downloads require a workspace, workflow, and execution file context'
    )
  }
  // Reuse the listing primitive to check known size and distinguish temporary snapshot downloads.
  const files = await listRepositoryFiles(client, signal)
  const matches = files.filter((file) => file.name === input.fileName)
  if (matches.length !== 1) {
    throw new OracleEpmPlatformFileError(
      'Choose a current repository file or snapshot name from List Files'
    )
  }
  const source = matches[0]
  if (source.size !== null && source.size > DOWNLOAD_FILE_LIMIT) {
    throw new OracleEpmPlatformFileError('Downloaded output cannot exceed 100 MiB')
  }
  let jobId: string | undefined
  let file: UserFile | undefined
  let cleanupComplete = true
  try {
    let value = jsonBody(
      await client.request(endpoints.download_file, {
        json: { fileName: input.fileName },
        signal,
      })
    )
    const status = readStatus(value)
    if (status === -1) {
      const job = readJobLink(client, value, jobLinkPolicies.download)
      jobId = job.id
      const result = await pollOracleEpmJob({
        read: async (readSignal) =>
          jsonBody(await client.requestValidatedLink(job.handle, readSignal)),
        classify: (snapshot) => {
          const code = readStatus(snapshot)
          return code === -1
            ? { state: 'pending' }
            : code === 0
              ? { state: 'success', result: snapshot }
              : { state: 'failure', error: new OracleEpmPlatformStatusError(code) }
        },
        signal,
        maxWaitMs: 120_000,
        cleanupReserveMs: 5_000,
        maxAttempts: 40,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
      })
      if (result.state === 'failure') throw result.error
      value = result.result
    } else {
      requireSuccess(value)
    }
    const download = readJobLink(client, value, downloadLinkPolicy, 'Download link')
    if (jobId !== undefined && jobId !== download.id) throw new OracleEpmPlatformResponseError()
    jobId = download.id
    const response = await client.requestValidatedLink(download.handle, signal)
    if (!('body' in response)) throw new OracleEpmPlatformResponseError()
    try {
      const mediaType = response.contentType?.split(';', 1)[0].trim().toLowerCase()
      if (mediaType === 'application/json' || mediaType?.endsWith('+json')) {
        throw new OracleEpmPlatformFileError(
          'Oracle EPM returned a JSON error instead of downloadable file bytes'
        )
      }
      file = await storeOracleEpmDownload({
        body: response.body,
        fileName:
          source.type === 'LCM' && !source.name.toLowerCase().endsWith('.zip')
            ? `${source.name}.zip`
            : source.name,
        contentType: response.contentType,
        contentLength: response.contentLength,
        context: {
          workspaceId: execution.workspaceId,
          workflowId: execution.workflowId,
          executionId: execution.executionId,
        },
        maxBytes: DOWNLOAD_FILE_LIMIT,
        signal,
      })
    } catch (error) {
      // Also cancel if size/content-type validation fails before the storage helper acquires a reader.
      await response.body.cancel().catch(() => undefined)
      throw error
    }
  } catch (error) {
    if (
      isPayloadSizeLimitError(error) ||
      (error instanceof OracleEpmError && error.category === 'payload_too_large')
    ) {
      throw new OracleEpmPlatformFileError('Downloaded output cannot exceed 100 MiB')
    }
    throw error
  } finally {
    if (source.type === 'LCM' && jobId !== undefined) {
      const ownedJobId = jobId
      cleanupComplete = await cleanupOwned(
        async (cleanup) =>
          requireSuccess(
            jsonBody(
              await client.request(deleteTemporaryDownloadEndpoint, {
                pathParams: { jobId: ownedJobId },
                signal: cleanup,
              })
            )
          ),
        signal
      )
    }
  }
  if (!file) throw new OracleEpmPlatformResponseError()
  return {
    ...statusOutput(0),
    ...(!cleanupComplete
      ? { message: 'Downloaded successfully; temporary snapshot download cleanup failed' }
      : {}),
    file,
    cleanupComplete,
  }
}
