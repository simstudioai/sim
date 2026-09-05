import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataExportMappingsParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataExportMappingsOperation: InternalToolOperationImplementation<
  OracleEpmDataExportMappingsParams
> = (params, signal) =>
  executeOracleEpmDataOperation('export_mappings', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.submitJob, {
      json: {
        jobType: 'MAPPINGEXPORT',
        jobName: input.dimension,
        fileName: input.fileName,
        locationName: input.locationName,
      },
      signal,
    })
    return finishOracleEpmDataJob(input, response, input.waitForCompletion, signal)
  })
