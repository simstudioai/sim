import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmApplyDataGrantsParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmApplyDataGrantsTool: InternalToolConfig<
  OraclePcmApplyDataGrantsParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_apply_data_grants',
  name: 'Oracle PCM Apply Data Grants',
  description:
    'Recreate Essbase data grants from the latest PCM application grants. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
  version: '1.0.0',
  oauth: oraclePcmOAuth,
  params: {
    ...oraclePcmAuthParams,
    applicationName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact PCM Management Ledger application name',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
