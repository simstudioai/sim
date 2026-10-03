import { Readable } from 'node:stream'
import { combineExecutionAbortSignals } from '@/lib/core/execution-limits'
import { readNodeStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import {
  type OracleEpmClient,
  type OracleEpmClientResponse,
  openOracleEpmSourceFile,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm'
import {
  ArcsContractError,
  arcsCommentsSchema,
  arcsFailure,
  arcsJobSchema,
  arcsStatusSchema,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import {
  classifyArcsStatus,
  resolveArcsArtifact,
  resolveArcsJobLink,
  waitForArcsJob,
} from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import {
  ARCS_MAX_FILE_BYTES,
  arcsArtifactPolicies,
  arcsRoutes,
} from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { ExecutionContext } from '@/lib/uploads/contexts/execution/utils'
import { isUuid } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import type { OracleEpmAccountReconciliationResponse } from '@/tools/oracle_epm_account_reconciliation/types'

/** Only executor-owned scope may choose where downloaded files are stored. */
export function getArcsFileContext(context?: InternalToolOperationContext): ExecutionContext {
  if (
    !context?.workspaceId ||
    !context.executionId ||
    !isUuid(context.workspaceId) ||
    !isUuid(context.workflowId) ||
    !isUuid(context.executionId)
  ) {
    throw new ArcsContractError('A valid workflow execution context is required to download files')
  }
  return {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
  }
}

export async function storeArcsFile(
  response: OracleEpmClientResponse,
  fileName: string,
  context: ExecutionContext,
  signal?: AbortSignal
): Promise<UserFile> {
  if (!('body' in response)) throw new ArcsContractError('Oracle EPM did not return file content')
  try {
    if (response.contentType?.split(';')[0].trim().toLowerCase() === 'application/json') {
      throw new ArcsContractError('Oracle EPM returned a JSON error instead of file content')
    }
    return await storeOracleEpmDownload({
      body: response.body,
      fileName,
      context,
      maxBytes: ARCS_MAX_FILE_BYTES,
      contentType: response.contentType,
      contentLength: response.contentLength,
      signal,
    })
  } catch (error) {
    await response.body.cancel().catch(() => undefined)
    throw error
  }
}

/** Upload staging is explicit and never deletes or overwrites an existing provider file. */
export async function uploadArcsFile(
  client: OracleEpmClient,
  params: { file: UserFile; fileName?: string; extDirPath?: string },
  context?: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<OracleEpmAccountReconciliationResponse> {
  if (!context?.userId) throw new ArcsContractError('An acting user is required to upload files')
  const source = await openOracleEpmSourceFile({
    file: params.file,
    userId: context.userId,
    maxBytes: ARCS_MAX_FILE_BYTES,
    signal,
  })
  const fileName = params.fileName ?? source.fileName
  const stagedName = params.extDirPath ? `${params.extDirPath}/${fileName}` : fileName
  if (Buffer.byteLength(stagedName, 'utf8') > 255)
    throw new ArcsContractError('The repository filename exceeds the supported path length')
  const bytes = await readNodeStreamToBufferWithLimit(Readable.from(source.chunks), {
    maxBytes: source.maxBytes,
    label: 'Oracle EPM upload',
    signal,
  })
  const result = parseArcsResponse(
    arcsStatusSchema,
    await client.request(arcsRoutes.uploadFile, {
      pathParams: { fileName },
      query: { extDirPath: params.extDirPath },
      stream: new Uint8Array(bytes),
      signal,
    })
  )
  const output = {
    status: result.status,
    details: result.details ?? null,
    state: classifyArcsStatus(result.status),
    fileName: stagedName,
  }
  return result.status > 0
    ? { success: false, error: 'Oracle EPM could not upload the file', output }
    : { success: true, output }
}

/** Re-fetch the reconciliation and bind the selected FILE reference before using its link. */
export async function downloadArcsAttachment(
  client: OracleEpmClient,
  params: { period: string; accountId: string; referenceId: string },
  context?: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<OracleEpmAccountReconciliationResponse> {
  const fileContext = getArcsFileContext(context)
  const comments = parseArcsResponse(
    arcsCommentsSchema,
    await client.request(arcsRoutes.comments, {
      pathParams: { period: params.period, accountId: params.accountId },
      signal,
    })
  )
  let reference: (typeof comments)[number]['references'][number] | undefined
  for (const comment of comments) {
    reference = comment.references.find(
      (item) => String(item.referenceId) === params.referenceId && item.type === 'FILE'
    )
    if (reference) break
  }
  if (!reference?.fileDownloadLink)
    throw new ArcsContractError('The FILE reference was not found on this reconciliation')
  const link = client.validateReturnedLink(arcsArtifactPolicies.attachment, {
    rel: 'attachment',
    method: 'GET',
    href: reference.fileDownloadLink,
  })
  if (
    new URL(reference.fileDownloadLink).pathname.split('/').at(-2) !== String(reference.referenceId)
  ) {
    throw new ArcsContractError('Oracle EPM attachment link does not match the selected reference')
  }
  const file = await storeArcsFile(
    await client.requestValidatedLink(link, signal),
    reference.name,
    fileContext,
    signal
  )
  return { success: true, output: { file } }
}

/** User reporting has one total start/wait/download budget and preserves an accepted job on failure. */
export async function exportArcsUserReport(
  client: OracleEpmClient,
  params: { fileName: string; format?: 'CSV' | 'XLS'; maxWaitSeconds?: number },
  context?: InternalToolOperationContext,
  signal?: AbortSignal
): Promise<OracleEpmAccountReconciliationResponse> {
  const fileContext = getArcsFileContext(context)
  const maxWaitSeconds = params.maxWaitSeconds ?? 60
  const deadline = Date.now() + maxWaitSeconds * 1_000
  const deadlineSignal = AbortSignal.timeout(maxWaitSeconds * 1_000)
  const reportSignal = signal
    ? combineExecutionAbortSignals([signal, deadlineSignal])
    : deadlineSignal
  let output: OracleEpmAccountReconciliationResponse['output'] = {}
  try {
    let job = parseArcsResponse(
      arcsJobSchema,
      await client.request(arcsRoutes.report, {
        json: { fileName: params.fileName, ...(params.format ? { format: params.format } : {}) },
        signal: reportSignal,
      })
    )
    output = {
      status: job.status,
      details: job.details ?? null,
      state: classifyArcsStatus(job.status),
      fileName: params.fileName,
    }
    if (job.status > 0)
      return { success: false, error: 'Oracle EPM could not start the user-details report', output }
    output.accepted = true
    const resolved = resolveArcsJobLink(client, 'report', job)
    if (resolved) output.jobId = resolved.jobId
    if (job.status === -1) {
      if (!resolved)
        throw new ArcsContractError(
          'Oracle EPM accepted the report but did not return a valid status link'
        )
      const remainingSeconds = Math.floor((deadline - Date.now()) / 1_000)
      if (remainingSeconds <= 1)
        throw new ArcsContractError('The report time budget expired after the job was accepted')
      job = await waitForArcsJob(client, resolved.link, remainingSeconds, reportSignal)
      output = {
        ...output,
        status: job.status,
        details: job.details ?? null,
        state: classifyArcsStatus(job.status),
      }
    }
    if (job.status !== 0)
      return {
        success: false,
        error: 'Oracle EPM user-details report completed with errors',
        output,
      }
    const artifact = job.links?.find((link) => link.rel === 'report-content')
    if (!artifact)
      throw new ArcsContractError('Oracle EPM completed the report without a download link')
    const resolvedArtifact = resolveArcsArtifact(client, artifact)
    if (resolvedArtifact.fileName !== params.fileName)
      throw new ArcsContractError('Oracle EPM report link does not match the requested filename')
    const file = await storeArcsFile(
      await client.requestValidatedLink(resolvedArtifact.link, reportSignal),
      resolvedArtifact.fileName,
      fileContext,
      reportSignal
    )
    return { success: true, output: { ...output, file } }
  } catch (error) {
    return arcsFailure(error, output)
  }
}
