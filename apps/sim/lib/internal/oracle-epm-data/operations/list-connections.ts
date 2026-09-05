import {
  executeOracleEpmDataOperation,
  oracleEpmDataConnectionsSchema,
  oracleEpmDataEndpoints,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataListConnectionsParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataListConnectionsOperation: InternalToolOperationImplementation<
  OracleEpmDataListConnectionsParams
> = (params, signal) =>
  executeOracleEpmDataOperation('list_connections', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.listConnections, {
      signal,
    })
    return projectOracleEpmDataResult(
      response,
      oracleEpmDataConnectionsSchema,
      ({ status, details, response }) => ({ status, details, connections: response })
    )
  })
