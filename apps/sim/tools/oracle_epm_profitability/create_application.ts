import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmCreateApplicationParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmCreateApplicationTool: InternalToolConfig<
  OraclePcmCreateApplicationParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_create_application',
  name: 'Oracle PCM Create Application',
  description:
    'Create a PCM file-based application with rule and balance dimensions. Requires Service Administrator. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Description of the application',
    },
    ruleDimensionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rule dimension name',
    },
    balanceDimensionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Balance dimension name',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
