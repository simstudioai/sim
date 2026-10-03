import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmMergeSlicesParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmMergeSlicesTool: InternalToolConfig<
  OraclePcmMergeSlicesParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_merge_slices',
  name: 'Oracle PCM Merge Slices',
  description:
    'Merge PCM incremental data slices into the main database slice. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    removeZeroCells: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remove zero-valued cells while merging slices',
      default: false,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
