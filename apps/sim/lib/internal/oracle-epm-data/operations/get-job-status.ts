import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataGetJobStatusParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataGetJobStatusOperation: InternalToolOperationImplementation<
  OracleEpmDataGetJobStatusParams
> = (params, signal) =>
  executeOracleEpmDataOperation('get_job_status', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.getJob, {
      pathParams: { jobId: input.jobId },
      signal,
    })
    return finishOracleEpmDataJob(input, response, input.waitForCompletion, signal)
  })
