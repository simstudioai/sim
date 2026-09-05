import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  oracleEpmDataFilesSchema,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataListFilesParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataListFilesOperation: InternalToolOperationImplementation<
  OracleEpmDataListFilesParams
> = (params, signal) =>
  executeOracleEpmDataOperation('list_files', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.listFiles, {
      signal,
    })
    return projectOracleEpmDataResult(
      response,
      oracleEpmDataFilesSchema,
      ({ status, details, items }) => ({ status, details, files: items })
    )
  })
