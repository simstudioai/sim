import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmResponse,
  OraclePcmUpdateDimensionsParams,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmUpdateDimensionsTool: InternalToolConfig<
  OraclePcmUpdateDimensionsParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_update_dimensions',
  name: 'Oracle PCM Update Dimensions',
  description:
    'Update PCM dimensions from metadata files already staged in profitinbox. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    dataFileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filename already staged in profitinbox; dimension updates accept a delimiter-separated list',
    },
    stringDelimiter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Single separator: defaults to underscore for POVs and comma for dimension file lists',
    },
    acceptableDecreasePercentage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum permitted dimension member decrease percentage, 0 to 100',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
