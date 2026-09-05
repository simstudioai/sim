import {
  executeOracleEpmDataOperation,
  oracleEpmDataConnectionSchema,
  oracleEpmDataEndpoints,
  oracleEpmDataStatusResponseSchema,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataGetConnectionParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataGetConnectionOperation: InternalToolOperationImplementation<
  OracleEpmDataGetConnectionParams
> = (params, signal) =>
  executeOracleEpmDataOperation('get_connection', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.getConnection, {
      pathParams: { connectionName: input.connectionName },
      signal,
    })
    const envelope = oracleEpmDataStatusResponseSchema.parse(response.data)
    if (envelope.status === 0) {
      const connection = oracleEpmDataConnectionSchema.parse(response.data).response
      if (connection.status !== 0) {
        return {
          success: false,
          retryable: false,
          output: { httpStatus: response.status, ...envelope, connection },
          error: `Oracle EPM connection returned status ${connection.status}`,
        }
      }
    }
    return projectOracleEpmDataResult(
      response,
      oracleEpmDataConnectionSchema,
      ({ status, details, response }) => ({ status, details, connection: response })
    )
  })
