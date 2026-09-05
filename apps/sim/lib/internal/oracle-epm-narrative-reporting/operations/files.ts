import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { storeOracleEpmDownload } from '@/lib/internal/oracle-epm/files.server'
import type { OracleEpmEndpoint, OracleEpmRequestInput } from '@/lib/internal/oracle-epm/types'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { NARRATIVE_MAX_DOWNLOAD_BYTES } from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import type { NarrativeDownloadInput } from '@/lib/internal/oracle-epm-narrative-reporting/schemas'
import { isUuid } from '@/executor/constants'

/** Streams only verified binary output, using server-authored execution storage scope. */
export async function downloadNarrativeOutput(
  context: NarrativeOperationContext,
  endpoint: OracleEpmEndpoint,
  input: NarrativeDownloadInput,
  query: OracleEpmRequestInput['query'],
  mediaTypes: readonly string[]
) {
  const { workspaceId, workflowId, executionId } = context.execution ?? {}
  if (
    !workspaceId ||
    !workflowId ||
    !executionId ||
    !isUuid(workspaceId) ||
    !isUuid(workflowId) ||
    !isUuid(executionId)
  ) {
    throw oracleEpmLocalError('invalid_input')
  }
  const response = await context.client.request(endpoint, {
    pathParams: { id: input.resourceId },
    query,
    signal: context.signal,
  })
  if (!('body' in response)) throw oracleEpmLocalError('invalid_response')
  try {
    if (
      response.status !== 200 ||
      !response.contentType ||
      !mediaTypes.includes(response.contentType.split(';', 1)[0].trim().toLowerCase())
    ) {
      throw oracleEpmLocalError('invalid_response')
    }
    const file = await storeOracleEpmDownload({
      body: response.body,
      fileName: input.fileName ?? `narrative-report-${input.resourceId}.${input.format}`,
      contentType: response.contentType,
      contentLength: response.contentLength,
      context: { workspaceId, workflowId, executionId },
      maxBytes: NARRATIVE_MAX_DOWNLOAD_BYTES,
      signal: context.signal,
    })
    return { success: true, output: { file } }
  } finally {
    /** Also closes bodies when storage fails before acquiring its reader. */
    await response.body.cancel().catch(() => undefined)
  }
}
