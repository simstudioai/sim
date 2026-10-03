import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  oracleEpmDataMessageSchema,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataUpdateConnectionParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataUpdateConnectionOperation: InternalToolOperationImplementation<
  OracleEpmDataUpdateConnectionParams
> = (params, signal) =>
  executeOracleEpmDataOperation('update_connection', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(
      input,
      oracleEpmDataEndpoints.updateConnection,
      {
        json: {
          sourceSystemId: input.sourceSystemId,
          sourceSystemName: input.sourceSystemName,
          sourceSystemType: input.sourceSystemType,
          sourceSystemOptions: input.sourceSystemOptions,
        },
        signal,
      }
    )
    return projectOracleEpmDataResult(response, oracleEpmDataMessageSchema, (data) => data)
  })
