import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataGetJobStatusParams,
  OracleEpmDataJobResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataGetJobStatusTool: InternalToolConfig<
  OracleEpmDataGetJobStatusParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_get_job_status',
  name: 'Oracle EPM Data Get Job Status',
  description:
    'Read a documented Data Integration job by its process ID, optionally waiting for completion.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Positive Data Integration process ID; snapshot import placeholder 0 is not usable',
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
