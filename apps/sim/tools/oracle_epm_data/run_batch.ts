import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataJobResponse,
  OracleEpmDataRunBatchParams,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataRunBatchTool: InternalToolConfig<
  OracleEpmDataRunBatchParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_run_batch',
  name: 'Oracle EPM Data Run Batch',
  description:
    'Execute a predefined Data Management batch with optional bounded completion waiting.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    jobName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing Data Management batch name',
    },
    waitForCompletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Wait up to five minutes for this documented job to finish; default false. Timeout preserves the job ID and never resubmits.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_JOB_OUTPUTS,
}
