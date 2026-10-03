import { Readable } from 'node:stream'
import { z } from 'zod'
import {
  readNodeStreamToBufferWithLimit,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  defineOracleEpmRouteSpace,
  oracleEpmLiteral as literal,
  openOracleEpmSourceFile,
  oracleEpmPathParameter as parameter,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm'
import {
  EPCM_MAX_JSON_BYTES,
  epcmName,
  normalizeOracleEpcmFiles,
  OracleEpcmOperationError,
  requireOracleEpcmRepositorySuccess,
} from '@/lib/internal/oracle-epm-enterprise-profitability/normalizers'
import {
  epcmAuthSchema,
  oracleEpcmClient,
  parseOracleEpcmInput,
  requestOracleEpcmJson,
} from '@/lib/internal/oracle-epm-enterprise-profitability/operations'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'
import type { OracleEpcmResponse } from '@/tools/oracle_epm_enterprise_profitability/types'

export const EPCM_MAX_TRANSFER_BYTES = 100 * 1024 * 1024
const interop = defineOracleEpmRouteSpace({
  context: ['interop', 'rest'],
  allowedVersions: ['v2', '11.1.2.3.600'],
})
const listEndpoint = interop.defineEndpoint({
  method: 'GET',
  version: 'v2',
  path: [literal('files'), literal('list')],
  body: 'none',
  response: 'json',
  timeoutMs: 30_000,
  maxResponseBytes: EPCM_MAX_JSON_BYTES,
})
const deleteEndpoint = interop.defineEndpoint({
  method: 'DELETE',
  version: 'v2',
  path: [literal('files'), literal('delete')],
  body: 'json',
  response: 'json',
  timeoutMs: 30_000,
  maxRequestBytes: 4_096,
  maxResponseBytes: EPCM_MAX_JSON_BYTES,
})
const contentsPath = [
  literal('applicationsnapshots'),
  parameter('fileName', { maxBytes: 255, mode: 'repository-path' }),
  literal('contents'),
]
const uploadEndpoint = interop.defineEndpoint({
  method: 'POST',
  version: '11.1.2.3.600',
  path: contentsPath,
  body: 'stream',
  response: 'json',
  timeoutMs: 300_000,
  maxRequestBytes: EPCM_MAX_TRANSFER_BYTES,
  maxResponseBytes: EPCM_MAX_JSON_BYTES,
})
const downloadEndpoint = interop.defineEndpoint({
  method: 'GET',
  version: '11.1.2.3.600',
  path: contentsPath,
  body: 'none',
  response: 'stream',
  timeoutMs: 300_000,
  maxResponseBytes: EPCM_MAX_TRANSFER_BYTES,
})
const fileSchema = epcmAuthSchema.extend({ fileName: epcmName })

export async function listOracleEpcmFiles(input: unknown, signal?: AbortSignal) {
  const params = parseOracleEpcmInput(epcmAuthSchema, input)
  return normalizeOracleEpcmFiles(
    await requestOracleEpcmJson(oracleEpcmClient(params), listEndpoint, { signal })
  )
}

function requireSourceFile(value: unknown): UserFile {
  const file = Array.isArray(value) && value.length === 1 ? value[0] : value
  if (!isUserFileWithMetadata(file)) {
    throw new OracleEpcmOperationError('Upload requires exactly one canonical Sim UserFile')
  }
  return file
}

export async function executeOracleEpcmFileOperation(
  operation: string,
  input: unknown,
  signal?: AbortSignal,
  context?: InternalToolOperationContext
): Promise<OracleEpcmResponse> {
  signal?.throwIfAborted()
  if (operation === 'list_files') {
    return { success: true, output: { files: await listOracleEpcmFiles(input, signal) } }
  }
  const params = parseOracleEpcmInput(fileSchema, input)
  const client = oracleEpcmClient(params)
  if (operation === 'upload_file') {
    const { file } = parseOracleEpcmInput(fileSchema.extend({ file: z.unknown() }), input)
    if (!context?.userId)
      throw new OracleEpcmOperationError('Uploading requires an authenticated execution actor')
    const source = await openOracleEpmSourceFile({
      file: requireSourceFile(file),
      userId: context.userId,
      maxBytes: EPCM_MAX_TRANSFER_BYTES,
      signal,
    })
    const body = await readNodeStreamToBufferWithLimit(Readable.from(source.chunks), {
      maxBytes: EPCM_MAX_TRANSFER_BYTES,
      label: 'Oracle EPCM upload',
      signal,
    })
    const data = await requestOracleEpcmJson(client, uploadEndpoint, {
      pathParams: { fileName: params.fileName },
      stream: body,
      signal,
    })
    requireOracleEpcmRepositorySuccess(data)
    return { success: true, output: { fileName: params.fileName, status: 0 }, retryable: false }
  }
  if (operation !== 'download_file' && operation !== 'delete_file') {
    throw new OracleEpcmOperationError('Unsupported Oracle EPCM file operation')
  }
  const executionContext =
    operation === 'download_file'
      ? parseOracleEpcmInput(
          z.object({
            workspaceId: z.string().uuid(),
            workflowId: z.string().uuid(),
            executionId: z.string().uuid(),
          }),
          context
        )
      : undefined
  /** Ordinary-file operations cannot target a listed LCM snapshot, even through a manual name. */
  const ordinaryFile = (await listOracleEpcmFiles(params, signal)).find(
    (file) => file.name === params.fileName
  )
  if (!ordinaryFile)
    throw new OracleEpcmOperationError(
      'The ordinary repository file was not found; snapshots are not supported',
      404
    )
  if (operation === 'delete_file') {
    requireOracleEpcmRepositorySuccess(
      await requestOracleEpcmJson(client, deleteEndpoint, {
        json: { fileName: params.fileName },
        signal,
      })
    )
    return { success: true, output: { fileName: params.fileName, status: 0 }, retryable: false }
  }
  if (ordinaryFile.size !== null && ordinaryFile.size > EPCM_MAX_TRANSFER_BYTES) {
    throw new OracleEpcmOperationError('The repository file exceeds the 100 MB transfer limit', 413)
  }
  const response = await client.request(downloadEndpoint, {
    pathParams: { fileName: params.fileName },
    signal,
  })
  if (!('body' in response))
    throw new OracleEpcmOperationError('Oracle returned an invalid download response', 502)
  if (response.contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json') {
    await readStreamToBufferWithLimit(response.body, {
      maxBytes: 65_536,
      label: 'Oracle EPCM download error',
      signal,
    })
    throw new OracleEpcmOperationError('Oracle rejected the file download; no file was stored', 502)
  }
  if (!executionContext)
    throw new OracleEpcmOperationError('A trusted execution file context is required')
  const file = await storeOracleEpmDownload({
    body: response.body,
    contentLength: response.contentLength,
    contentType: response.contentType,
    fileName: params.fileName.split('/').at(-1) || params.fileName,
    context: executionContext,
    maxBytes: EPCM_MAX_TRANSFER_BYTES,
    signal,
  })
  return { success: true, output: { file } }
}
