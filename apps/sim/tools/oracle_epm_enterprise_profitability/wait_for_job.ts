import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmResponse,
  OracleEpcmWaitForJobParams,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_WAIT_FOR_JOB_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmWaitForJobTool: InternalToolConfig<
  OracleEpcmWaitForJobParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_wait_for_job',
  name: 'Oracle EPCM Wait for Job',
  description:
    'Wait with a bounded timeout for an existing Oracle job. Timeout or local cancellation does not cancel the remote job.',
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
    maxWaitSeconds: {
      type: 'number',
      required: false,
      description: 'Maximum local wait, 1–3600 seconds; also bounded by the execution deadline',
      default: 300,
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_WAIT_FOR_JOB_OUTPUTS,
}
