import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  oracleEpmDataPovSchema,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataGetPovStatusParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataGetPovStatusOperation: InternalToolOperationImplementation<
  OracleEpmDataGetPovStatusParams
> = (params, signal) =>
  executeOracleEpmDataOperation('get_pov_status', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.getPov, {
      query: {
        period: input.period,
        category: input.category,
        application: input.application,
        location: input.locationName,
      },
      signal,
    })
    return projectOracleEpmDataResult(
      response,
      oracleEpmDataPovSchema,
      ({ status, details, response }) => ({ status, details, povs: response })
    )
  })
