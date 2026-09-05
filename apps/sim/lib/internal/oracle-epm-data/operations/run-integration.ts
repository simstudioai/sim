import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataRunIntegrationParams } from '@/tools/oracle_epm_data/types'

/** Oracle documents the request, not a response schema. Success here means response retrieval only. */
export const executeOracleEpmDataRunIntegrationOperation: InternalToolOperationImplementation<
  OracleEpmDataRunIntegrationParams
> = (params, signal) =>
  executeOracleEpmDataOperation('run_integration', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.submitJob, {
      json: {
        jobType: 'INTEGRATION',
        jobName: input.jobName,
        periodName: input.periodName,
        importMode: input.importMode,
        exportMode: input.exportMode,
        fileName: input.fileName,
        executionMode: input.executionMode,
        sourceFilters: input.sourceFilters,
        targetOptions: input.targetOptions,
      },
      signal,
    })
    return { success: true, output: { httpStatus: response.status, data: response.data } }
  })
