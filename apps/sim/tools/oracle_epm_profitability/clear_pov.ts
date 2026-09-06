import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmClearPovParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmClearPovTool: InternalToolConfig<OraclePcmClearPovParams, OraclePcmResponse> =
  {
    id: 'oracle_epm_profitability_clear_pov',
    name: 'Oracle PCM Clear POV',
    description:
      'Clear selected PCM POV rules or data, optionally limiting input data by an existing query. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
      povName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'POV members joined by stringDelimiter; model POV for calculations',
      },
      isManageRule: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Copy or clear program rules for the selected POV',
        default: false,
      },
      isInputData: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Copy or clear input data for the selected POV',
        default: false,
      },
      queryName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Existing PCM query; exports with no query export all application data',
      },
      isAllocatedValues: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Clear allocated values; incompatible with queryName',
        default: false,
      },
      isAdjustmentValues: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Clear adjustment values; incompatible with queryName',
        default: false,
      },
      stringDelimiter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Single separator: defaults to underscore for POVs and comma for dimension file lists',
      },
    },
    operation: { input: createInternalToolOperationInput },
    outputs: ORACLE_PCM_TASK_OUTPUTS,
  }
