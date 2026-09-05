import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { storeOracleEpmDownload } from '@/lib/internal/oracle-epm'
import {
  executeOracleEpmDataOperation,
  ORACLE_EPM_DATA_FILE_MAX_BYTES,
  oracleEpmDataClient,
  oracleEpmDataEndpoints,
  oracleEpmDataStatusResponseSchema,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { isUuid } from '@/executor/constants'
import type { OracleEpmDataDownloadFileParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataDownloadFileOperation: InternalToolOperationImplementation<
  OracleEpmDataDownloadFileParams
> = (params, signal, context) =>
  executeOracleEpmDataOperation('download_file', params, signal, async (input) => {
    if (
      !context?.userId ||
      !context.workspaceId ||
      !context.executionId ||
      !isUuid(context.workspaceId) ||
      !isUuid(context.workflowId) ||
      !isUuid(context.executionId)
    ) {
      throw new Error('Oracle EPM download requires trusted workflow execution file context')
    }
    const response = await oracleEpmDataClient(input).request(oracleEpmDataEndpoints.downloadFile, {
      pathParams: { fileName: input.fileName },
      signal,
    })
    if (!('body' in response))
      throw new Error('Oracle EPM did not return the declared download stream')
    const contentType = response.contentType?.split(';')[0].trim().toLowerCase()
    if (contentType === 'application/json' || contentType?.endsWith('+json')) {
      const bytes = await readStreamToBufferWithLimit(response.body, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Oracle EPM download error',
        signal,
      })
      const error = oracleEpmDataStatusResponseSchema.parse(JSON.parse(bytes.toString('utf8')))
      return {
        success: false,
        retryable: false,
        output: { httpStatus: response.status, ...error, fileName: input.fileName },
        error: 'Oracle EPM returned a JSON error instead of a file',
      }
    }
    const file = await storeOracleEpmDownload({
      body: response.body,
      fileName: input.fileName.split(/[\\/]/).at(-1) ?? input.fileName,
      contentType,
      contentLength: response.contentLength,
      context: {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      maxBytes: ORACLE_EPM_DATA_FILE_MAX_BYTES,
      signal,
    })
    return {
      success: true,
      output: { httpStatus: response.status, fileName: input.fileName, file },
    }
  })
