import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  oracleEpmDataStatusResponseSchema,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataDeleteFileParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataDeleteFileOperation: InternalToolOperationImplementation<
  OracleEpmDataDeleteFileParams
> = (params, signal) =>
  executeOracleEpmDataOperation('delete_file', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.deleteFile, {
      json: { fileName: input.fileName },
      signal,
    })
    return projectOracleEpmDataResult(response, oracleEpmDataStatusResponseSchema, (data) => ({
      ...data,
      fileName: input.fileName,
    }))
  })
