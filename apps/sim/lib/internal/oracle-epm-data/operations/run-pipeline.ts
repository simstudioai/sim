import { filterUndefined } from '@sim/utils/object'
import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataRunPipelineParams } from '@/tools/oracle_epm_data/types'

/** Oracle documents the request, not a response schema. Success here means response retrieval only. */
export const executeOracleEpmDataRunPipelineOperation: InternalToolOperationImplementation<
  OracleEpmDataRunPipelineParams
> = (params, signal) =>
  executeOracleEpmDataOperation('run_pipeline', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.submitJob, {
      json: filterUndefined({
        jobType: 'PIPELINE',
        jobName: input.pipelineCode,
        variables: input.variables,
      }),
      signal,
    })
    return { success: true, output: { httpStatus: response.status, data: response.data } }
  })
