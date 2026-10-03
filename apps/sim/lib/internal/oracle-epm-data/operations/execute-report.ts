import {
  executeOracleEpmDataOperation,
  oracleEpmDataEndpoints,
  requestOracleEpmDataJson,
} from '@/lib/internal/oracle-epm-data/contracts'
import { finishOracleEpmDataJob } from '@/lib/internal/oracle-epm-data/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmDataExecuteReportParams } from '@/tools/oracle_epm_data/types'

export const executeOracleEpmDataExecuteReportOperation: InternalToolOperationImplementation<
  OracleEpmDataExecuteReportParams
> = (params, signal) =>
  executeOracleEpmDataOperation('execute_report', params, signal, async (input) => {
    const response = await requestOracleEpmDataJson(input, oracleEpmDataEndpoints.submitJob, {
      json: {
        jobType: 'REPORT',
        jobName: input.jobName,
        reportFormatType: input.reportFormatType,
        parameters: input.parameters,
      },
      signal,
    })
    return finishOracleEpmDataJob(input, response, input.waitForCompletion, signal)
  })
