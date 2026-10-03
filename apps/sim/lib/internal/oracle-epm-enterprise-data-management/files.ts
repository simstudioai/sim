import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { OracleEpmClientResponse, OracleEpmEndpoint } from '@/lib/internal/oracle-epm'
import { openOracleEpmSourceFile, storeOracleEpmDownload } from '@/lib/internal/oracle-epm'
import {
  EDM_FILE_BYTES,
  EDM_MULTIPART_BYTES,
} from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import {
  type EdmOperationContext,
  EdmOperationError,
  edmJsonData,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'
import { parseRawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { isUuid } from '@/executor/constants'

const logger = createLogger('OracleEpmEdmFiles')

export function requireEdmDownloadContext(context: EdmOperationContext) {
  const { workspaceId, workflowId, executionId } = context.execution
  if (
    !workspaceId ||
    !executionId ||
    !isUuid(workspaceId) ||
    !isUuid(workflowId) ||
    !isUuid(executionId)
  ) {
    throw new EdmOperationError(
      'A trusted workspace, workflow, and execution are required to store EDM files'
    )
  }
  return { workspaceId, workflowId, executionId }
}

/** Multipart field values are data, never interpolated into MIME headers. */
export async function buildEdmMultipart(
  input: unknown,
  fileName: string | undefined,
  context: EdmOperationContext
) {
  if (!context.execution.userId)
    throw new EdmOperationError('An authenticated execution user is required to upload a file')
  const raw = parseRawFileInput(input)
  if (!raw) throw new EdmOperationError('Select one uploaded Sim file')
  const files = processFilesToUserFiles(raw, 'oracle-epm-edm', logger)
  if (files.length !== 1) throw new EdmOperationError('Select exactly one uploaded Sim file')
  const file = files[0]
  const source = await openOracleEpmSourceFile({
    file,
    userId: context.execution.userId,
    maxBytes: EDM_FILE_BYTES,
    signal: context.signal,
  })
  const outputName = fileName ?? source.fileName
  const boundary = `sim-edm-${generateId()}`
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="fileName"\r\n\r\n${outputName}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload"\r\nContent-Type: ${source.contentType}\r\n\r\n`
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
  let bytes = prefix.length + suffix.length
  const chunks: Buffer[] = [prefix]
  for await (const chunk of source.chunks) {
    bytes += chunk.length
    if (bytes > EDM_MULTIPART_BYTES)
      throw new EdmOperationError('EDM multipart body exceeds 100 MiB', 413)
    chunks.push(chunk)
  }
  chunks.push(suffix)
  context.signal?.throwIfAborted()
  return {
    body: new Uint8Array(Buffer.concat(chunks, bytes)),
    contentType: `multipart/form-data; boundary=${boundary}`,
    fileName: outputName,
  }
}

export async function uploadEdmFile(
  endpoint: OracleEpmEndpoint,
  input: unknown,
  fileName: string | undefined,
  context: EdmOperationContext,
  pathParams?: Record<string, string>
) {
  const multipart = await buildEdmMultipart(input, fileName, context)
  const response = await context.client.request(endpoint, {
    pathParams,
    headers: { contentType: multipart.contentType },
    stream: multipart.body,
    signal: context.signal,
  })
  return { data: edmJsonData(response), fileName: multipart.fileName }
}

export async function storeEdmFile(
  response: OracleEpmClientResponse,
  fileName: string,
  context: EdmOperationContext
) {
  const execution = requireEdmDownloadContext(context)
  if (!('body' in response)) throw new EdmOperationError('Oracle EDM did not return a file', 502)
  return storeOracleEpmDownload({
    body: response.body,
    fileName,
    contentType: response.contentType,
    contentLength: response.contentLength,
    context: execution,
    maxBytes: EDM_FILE_BYTES,
    signal: context.signal,
  })
}
