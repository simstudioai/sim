import { filterUndefined } from '@sim/utils/object'
import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataRunDataRuleParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataRunDataRuleOperation: InternalToolOperationImplementation<
  OracleEpmDataRunDataRuleParams
> = (params, signal) =>
  executeOracleEpmDataOperation('run_data_rule', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.submitJob, {
      json: filterUndefined({
        jobType: 'DATARULE',
        jobName: input.jobName,
        startPeriod: input.startPeriod,
        endPeriod: input.endPeriod,
        importMode: input.importMode,
        exportMode: input.exportMode,
        fileName: input.fileName,
      }),
      signal,
    })
    return finishOracleEpmDataJob(input, response, input.waitForCompletion, signal)
  })
