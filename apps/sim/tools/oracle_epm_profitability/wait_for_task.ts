import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmResponse,
  OraclePcmWaitForTaskParams,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_WAIT_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmWaitForTaskTool: InternalToolConfig<
  OraclePcmWaitForTaskParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_wait_for_task',
  name: 'Oracle PCM Wait for Task',
  description:
    'Wait within a bounded deadline for a PCM task; retain processName to resume after timeout. Requires Service Administrator or Power User.',
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
    maxWaitSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum wait in seconds, 1 to 3600; does not cancel the remote task',
      default: 300,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_WAIT_OUTPUTS,
}
