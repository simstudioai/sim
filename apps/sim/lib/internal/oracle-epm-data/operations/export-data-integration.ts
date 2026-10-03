import { filterUndefined } from '@sim/utils/object'
import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataExportDataIntegrationParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataExportDataIntegrationOperation: InternalToolOperationImplementation<
  OracleEpmDataExportDataIntegrationParams
> = (params, signal) =>
  executeOracleEpmDataOperation('export_data_integration', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.snapshot, {
      json: filterUndefined({
        action: 'EXPORT',
        snapshotType: input.snapshotType,
        fileName: input.fileName,
        overwriteFile: input.overwriteFile,
      }),
      signal,
    })
    return finishOracleEpmDataJob(input, response, input.waitForCompletion, signal)
  })
