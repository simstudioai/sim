import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmCopyPovParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmCopyPovTool: InternalToolConfig<OraclePcmCopyPovParams, OraclePcmResponse> = {
  id: 'oracle_epm_profitability_copy_pov',
  name: 'Oracle PCM Copy POV',
  description:
    'Copy PCM rules and input data to a destination POV. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    destinationPovName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination POV members joined by stringDelimiter',
    },
    isManageRule: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Copy or clear program rules for the selected POV',
      default: false,
    },
    isInputData: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Copy or clear input data for the selected POV',
      default: false,
    },
    modelViewName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing model view to limit the data slice',
    },
    createDestPOV: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Create the destination POV if it does not exist',
      default: false,
    },
    nonEmptyTupleEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable nonempty tuple optimization when copying data',
      default: true,
    },
    stringDelimiter: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Single separator: defaults to underscore for POVs and comma for dimension file lists',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
