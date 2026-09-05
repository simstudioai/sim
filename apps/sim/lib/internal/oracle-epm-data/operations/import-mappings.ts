import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataImportMappingsParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataImportMappingsOperation: InternalToolOperationImplementation<
  OracleEpmDataImportMappingsParams
> = (params, signal) =>
  executeOracleEpmDataOperation('import_mappings', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.submitJob, {
      json: {
        jobType: 'MAPPINGIMPORT',
        jobName: input.dimension,
        fileName: input.fileName,
        importMode: input.importMode,
        validationMode: input.validationMode,
        locationName: input.locationName,
      },
      signal,
    })
    return finishOracleEpmDataJob(input, response, input.waitForCompletion, signal)
  })
