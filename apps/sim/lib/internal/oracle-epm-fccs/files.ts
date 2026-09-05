import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { openOracleEpmSourceFile, storeOracleEpmDownload } from '@/lib/internal/oracle-epm'
import { type FccsContext, projectFccsResponse } from '@/lib/internal/oracle-epm-fccs/context'
import { FCCS_FILE_LIMIT, fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsFileStatusSchema, fccsFilesSchema } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { UserFile } from '@/executor/types'

/** Repository files, not LCM snapshots. List Files v2 documents the EXTERNAL discriminator. */
export async function listFccsFiles(context: FccsContext) {
  const result = projectFccsResponse(
    fccsFilesSchema,
    await context.client.request(fccsEndpoints.listFiles, { signal: context.signal })
  )
  if (result.status !== 0) throw new Error('Oracle EPM FCCS could not list repository files')
  return { ...result, items: result.items.filter((file) => file.type === 'EXTERNAL') }
}

async function requireExternalFile(context: FccsContext, fileName: string) {
  const files = await listFccsFiles(context)
  const comparisonName = fileName.replaceAll('\\', '/')
  const file = files.items.find((item) => item.name.replaceAll('\\', '/') === comparisonName)
  if (!file)
    throw new Error('FCCS external repository file was not found; LCM snapshots are not supported')
  return file
}

export async function uploadFccsFile(
  context: FccsContext,
  file: UserFile,
  fileName: string,
  directory?: string
) {
  if (!context.execution?.userId) throw new Error('FCCS upload requires trusted user context')
  if (/[\\/]/.test(fileName))
    throw new Error('FCCS upload filename must be a basename; use Directory for a folder')
  if (
    directory !== undefined &&
    (!/^(inbox|outbox)([/\\][^/\\]+)*$/.test(directory) ||
      directory.split(/[/\\]/).some((part) => part === '.' || part === '..'))
  ) {
    throw new Error('FCCS upload directory must be inbox or outbox, optionally with subdirectories')
  }
  const source = await openOracleEpmSourceFile({
    file,
    userId: context.execution.userId,
    maxBytes: FCCS_FILE_LIMIT,
    signal: context.signal,
  })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of source.chunks) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  context.signal?.throwIfAborted()
  const result = projectFccsResponse(
    fccsFileStatusSchema,
    await context.client.request(fccsEndpoints.uploadFile, {
      pathParams: { fileName },
      query: { extDirPath: directory },
      stream: new Uint8Array(Buffer.concat(chunks, size)),
      signal: context.signal,
    })
  )
  if (result.status !== 0)
    throw new Error(
      'Oracle EPM FCCS upload did not complete; inspect the repository. LCM extraction is not supported'
    )
  return { ...result, fileName: directory ? `${directory}/${fileName}` : fileName }
}

export async function downloadFccsFile(context: FccsContext, fileName: string) {
  const { workspaceId, workflowId, executionId } = context.execution ?? {}
  if (!workspaceId || !workflowId || !executionId)
    throw new Error('FCCS download requires trusted execution context')
  const existing = await requireExternalFile(context, fileName)
  if (existing.size !== null && BigInt(existing.size) > BigInt(FCCS_FILE_LIMIT)) {
    throw new Error(
      'FCCS file exceeds the 100 MiB Sim output limit. The Oracle export may have completed; retrieve or split the file outside Sim.'
    )
  }
  const response = await context.client.request(fccsEndpoints.downloadFile, {
    pathParams: { fileName },
    signal: context.signal,
  })
  if (!('body' in response))
    throw new Error('Oracle EPM FCCS returned an unexpected download response')
  const mediaType = response.contentType?.split(';')[0].trim().toLowerCase()
  if (mediaType === 'application/json' || mediaType?.endsWith('+json')) {
    await response.body.cancel()
    throw new Error('Oracle EPM FCCS returned a JSON error instead of a file')
  }
  try {
    const file = await storeOracleEpmDownload({
      ...response,
      fileName: fileName.split(/[/\\]/).at(-1)!,
      context: { workspaceId, workflowId, executionId },
      maxBytes: FCCS_FILE_LIMIT,
      signal: context.signal,
    })
    return { file, fileName }
  } catch (error) {
    await response.body.cancel().catch(() => undefined)
    throw error
  }
}

export async function deleteFccsFile(context: FccsContext, fileName: string) {
  await requireExternalFile(context, fileName)
  const result = projectFccsResponse(
    fccsFileStatusSchema,
    await context.client.request(fccsEndpoints.deleteFile, {
      json: { fileName },
      signal: context.signal,
    })
  )
  if (result.status !== 0) throw new Error('Oracle EPM FCCS could not delete the repository file')
  return { ...result, fileName }
}

/** These endpoints return text, not a job envelope. Never manufacture an execution ID. */
export async function submitFccsConsolidationRulesets(
  context: FccsContext,
  operation: 'export' | 'import',
  application: string,
  payload: { rules: string[] } | { file: string }
) {
  const endpoint =
    operation === 'export'
      ? fccsEndpoints.exportConsolidationRulesets
      : fccsEndpoints.importConsolidationRulesets
  const response = await context.client.request(endpoint, {
    pathParams: { application },
    json: payload,
    signal: context.signal,
  })
  if (!('body' in response))
    throw new Error('Oracle EPM FCCS returned an unexpected ruleset acknowledgement')
  const message = (
    await readResponseTextWithLimit(response, {
      maxBytes: 64 * 1024,
      label: 'FCCS ruleset acknowledgement',
    })
  ).trim()
  context.signal?.throwIfAborted()
  if (message !== 'Job is submitted. See the job console for more information.')
    throw new Error(
      'Oracle EPM FCCS did not return the documented ruleset submission acknowledgement'
    )
  return { submitted: true, message }
}
