import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmGetTaskStatusParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmGetTaskStatusTool: InternalToolConfig<
  OraclePcmGetTaskStatusParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_get_task_status',
  name: 'Oracle PCM Get Task Status',
  description:
    'Read PCM task status using its processName. Requires Service Administrator or Power User.',
  version: '1.0.0',
  oauth: oraclePcmOAuth,
  params: {
    ...oraclePcmAuthParams,
    processName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task processName returned by PCM submission; not a numeric EPCM job ID',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
