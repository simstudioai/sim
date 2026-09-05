import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  oracleEpmDataPipelineSchema,
  projectOracleEpmDataResult,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataGetPipelineDetailsParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataGetPipelineDetailsOperation: InternalToolOperationImplementation<
  OracleEpmDataGetPipelineDetailsParams
> = (params, signal) =>
  executeOracleEpmDataOperation('get_pipeline_details', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.getPipeline, {
      query: { pipelineName: input.pipelineCode },
      signal,
    })
    return projectOracleEpmDataResult(
      response,
      oracleEpmDataPipelineSchema,
      ({ status, details, response }) => ({ status, details, pipeline: response })
    )
  })
