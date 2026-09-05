import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmLoadDataParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmLoadDataTool: InternalToolConfig<OraclePcmLoadDataParams, OraclePcmResponse> =
  {
    id: 'oracle_epm_profitability_load_data',
    name: 'Oracle PCM Load Data',
    description:
      'Load Essbase input data from a file in profitinbox. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
      clearAllDataFlag: {
        type: 'boolean',
        required: true,
        visibility: 'user-or-llm',
        description: 'Clear all existing data before loading',
        default: false,
      },
      dataLoadValue: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'How incoming values affect existing data Allowed values: ADD_EXISTING_VALUES, OVERWRITE_EXISTING_VALUES.',
        default: 'OVERWRITE_EXISTING_VALUES',
      },
      dataFileName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Filename already staged in profitinbox; dimension updates accept a delimiter-separated list',
      },
    },
    operation: { input: createInternalToolOperationInput },
    outputs: ORACLE_PCM_TASK_OUTPUTS,
  }
