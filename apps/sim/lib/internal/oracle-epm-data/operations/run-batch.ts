import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataRunBatchParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataRunBatchOperation: InternalToolOperationImplementation<
  OracleEpmDataRunBatchParams
> = (params, signal) =>
  executeOracleEpmDataOperation('run_batch', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.submitJob, {
      json: { jobType: 'BATCH', jobName: input.jobName },
      signal,
    })
    return finishOracleEpmDataJob(input, response, input.waitForCompletion, signal)
  })
