import { openOracleEpmSourceFile } from '@/lib/internal/oracle-epm'
import {
  executeOracleEpmDataOperation,
  ORACLE_EPM_DATA_FILE_MAX_BYTES,
  oracleEpmDataEndpoints,
  oracleEpmDataStatusResponseSchema,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataUploadFileParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataUploadFileOperation: InternalToolOperationImplementation<
  OracleEpmDataUploadFileParams
> = (params, signal, context) =>
  executeOracleEpmDataOperation('upload_file', params, signal, async (input) => {
    if (!context?.userId) throw new Error('Oracle EPM upload requires trusted user context')
    const source = await openOracleEpmSourceFile({
      file: input.file,
      userId: context.userId,
      maxBytes: ORACLE_EPM_DATA_FILE_MAX_BYTES,
      signal,
    })
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of source.chunks) {
      signal?.throwIfAborted()
      bytes += chunk.byteLength
      chunks.push(chunk)
    }
    signal?.throwIfAborted()
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.uploadFile, {
      pathParams: { fileName: input.fileName },
      query: { extDirPath: input.extDirPath },
      stream: Buffer.concat(chunks, bytes),
      signal,
    })
    const result = oracleEpmDataStatusResponseSchema.parse(response.data)
    /** Status -1 means snapshot extraction is still running, not completed work. */
    const success = result.status === 0 || result.status === -1
    return {
      success,
      output: {
        httpStatus: response.status,
        ...result,
        fileName: input.extDirPath ? `${input.extDirPath}/${input.fileName}` : input.fileName,
      },
      ...(!success
        ? { retryable: false, error: `Oracle EPM upload returned status ${result.status}` }
        : {}),
    }
  })
