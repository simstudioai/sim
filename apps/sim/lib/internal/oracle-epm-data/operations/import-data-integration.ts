import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataImportDataIntegrationParams } from '@/tools/oracle_epm_data/types'

/** Oracle documents jobId 0 for imports; it is returned but must never be polled. */
export const executeOracleEpmDataImportDataIntegrationOperation: InternalToolOperationImplementation<
  OracleEpmDataImportDataIntegrationParams
> = (params, signal) =>
  executeOracleEpmDataOperation('import_data_integration', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.snapshot, {
      json: { action: 'IMPORT', fileName: input.fileName },
      signal,
    })
    return finishOracleEpmDataJob(input, response, false, signal)
  })
