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
  oracleEpmQuery,
  oracleEpmPathParameter as parameter,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm'
import {
  normalizeOraclePcmFiles,
  OraclePcmOperationError,
  PCM_MAX_JSON_BYTES,
  pcmFileName,
  pcmRepositoryName,
  requireOraclePcmDownloadablePath,
  requireOraclePcmRepositorySuccess,
} from '@/lib/internal/oracle-epm-profitability/normalizers'
import {
  oraclePcmClient,
  parseOraclePcmInput,
  pcmAuthSchema,
  requestOraclePcmJson,
} from '@/lib/internal/oracle-epm-profitability/operations'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'
import type { OraclePcmResponse } from '@/tools/oracle_epm_profitability/types'

export const PCM_MAX_TRANSFER_BYTES = 100 * 1024 * 1024
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
  maxResponseBytes: PCM_MAX_JSON_BYTES,
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
  maxRequestBytes: PCM_MAX_TRANSFER_BYTES,
  query: {
    extDirPath: oracleEpmQuery.string({ required: true, maxBytes: 11, pattern: /^profitinbox$/ }),
  },
  maxResponseBytes: PCM_MAX_JSON_BYTES,
})
const downloadEndpoint = interop.defineEndpoint({
  method: 'GET',
  version: '11.1.2.3.600',
  path: contentsPath,
  body: 'none',
  response: 'stream',
  timeoutMs: 300_000,
  maxResponseBytes: PCM_MAX_TRANSFER_BYTES,
})
const fileSchema = pcmAuthSchema.extend({ fileName: pcmRepositoryName })

export async function listOraclePcmFiles(input: unknown, signal?: AbortSignal) {
  const params = parseOraclePcmInput(pcmAuthSchema, input)
  return normalizeOraclePcmFiles(
    await requestOraclePcmJson(oraclePcmClient(params), listEndpoint, { signal })
  )
}

function requireSourceFile(value: unknown): UserFile {
  const file = Array.isArray(value) && value.length === 1 ? value[0] : value
  if (!isUserFileWithMetadata(file)) {
    throw new OraclePcmOperationError('Upload requires exactly one canonical Sim UserFile')
  }
  return file
}

export async function executeOraclePcmFileOperation(
  operation: string,
  input: unknown,
  signal?: AbortSignal,
  context?: InternalToolOperationContext
): Promise<OraclePcmResponse> {
  signal?.throwIfAborted()
  if (operation === 'list_files') {
    return { success: true, output: { files: await listOraclePcmFiles(input, signal) } }
  }
  const params = parseOraclePcmInput(
    operation === 'upload_file' ? fileSchema.extend({ fileName: pcmFileName }) : fileSchema,
    input
  )
  const client = oraclePcmClient(params)
  if (operation === 'upload_file') {
    requireOraclePcmDownloadablePath(`profitinbox/${params.fileName}`)
    const { file } = parseOraclePcmInput(fileSchema.extend({ file: z.unknown() }), input)
    if (!context?.userId)
      throw new OraclePcmOperationError('Uploading requires an authenticated execution actor')
    const source = await openOracleEpmSourceFile({
      file: requireSourceFile(file),
      userId: context.userId,
      maxBytes: PCM_MAX_TRANSFER_BYTES,
      signal,
    })
    const body = await readNodeStreamToBufferWithLimit(Readable.from(source.chunks), {
      maxBytes: PCM_MAX_TRANSFER_BYTES,
      label: 'Oracle PCM upload',
      signal,
    })
    const data = await requestOraclePcmJson(client, uploadEndpoint, {
      pathParams: { fileName: params.fileName },
      query: { extDirPath: 'profitinbox' },
      stream: body,
      signal,
    })
    requireOraclePcmRepositorySuccess(data)
    return {
      success: true,
      output: { fileName: `profitinbox/${params.fileName}`, status: 0 },
      retryable: false,
    }
  }
  if (operation !== 'download_file') {
    throw new OraclePcmOperationError('Unsupported Oracle PCM file operation')
  }
  requireOraclePcmDownloadablePath(params.fileName)
  const executionContext =
    operation === 'download_file'
      ? parseOraclePcmInput(
          z.object({
            workspaceId: z.string().uuid(),
            workflowId: z.string().uuid(),
            executionId: z.string().uuid(),
          }),
          context
        )
      : undefined
  /** Ordinary-file operations cannot target a listed LCM snapshot, even through a manual name. */
  const ordinaryFile = (await listOraclePcmFiles(params, signal)).find(
    (file) => file.name === params.fileName
  )
  if (!ordinaryFile)
    throw new OraclePcmOperationError(
      'The ordinary repository file was not found; snapshots are not supported',
      404
    )
  if (ordinaryFile.size !== null && ordinaryFile.size > PCM_MAX_TRANSFER_BYTES) {
    throw new OraclePcmOperationError('The repository file exceeds the 100 MiB transfer limit', 413)
  }
  const response = await client.request(downloadEndpoint, {
    pathParams: { fileName: params.fileName },
    signal,
  })
  if (!('body' in response))
    throw new OraclePcmOperationError('Oracle returned an invalid download response', 502)
  if (response.contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json') {
    await readStreamToBufferWithLimit(response.body, {
      maxBytes: 65_536,
      label: 'Oracle PCM download error',
      signal,
    })
    throw new OraclePcmOperationError('Oracle rejected the file download; no file was stored', 502)
  }
  if (!executionContext)
    throw new OraclePcmOperationError('A trusted execution file context is required')
  const file = await storeOracleEpmDownload({
    body: response.body,
    contentLength: response.contentLength,
    contentType: response.contentType,
    fileName: params.fileName.split('/').at(-1) || params.fileName,
    context: executionContext,
    maxBytes: PCM_MAX_TRANSFER_BYTES,
    signal,
  })
  return { success: true, output: { file } }
}
