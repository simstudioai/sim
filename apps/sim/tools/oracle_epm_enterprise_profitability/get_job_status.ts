import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmGetJobStatusParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmGetJobStatusTool: InternalToolConfig<
  OracleEpcmGetJobStatusParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_get_job_status',
  name: 'Oracle EPCM Get Job Status',
  description: 'Read one Oracle job status without resubmitting or waiting.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,

    applicationName: {
      type: 'string',
      required: true,
      description: 'Exact EPCM application name',
      visibility: 'user-or-llm',
    },
    jobId: {
      type: 'string',
      required: true,
      description: 'Oracle job ID returned by a submission',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
