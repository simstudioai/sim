import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  oracleEpmDataMessageSchema,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataSetPovLockParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataSetPovLockOperation: InternalToolOperationImplementation<
  OracleEpmDataSetPovLockParams
> = (params, signal) =>
  executeOracleEpmDataOperation('set_pov_lock', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.setPov, {
      json: {
        period: input.period,
        category: input.category,
        locktype: input.lockType,
        operation: input.lockOperation,
        ...(input.lockType === 'application'
          ? { application: input.application, unlockbylocation: input.unlockByLocation }
          : { location: input.locationName }),
      },
      signal,
    })
    return projectOracleEpmDataResult(response, oracleEpmDataMessageSchema, (data) => data)
  })
