import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmDeployCubeParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmDeployCubeTool: InternalToolConfig<
  OraclePcmDeployCubeParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_deploy_cube',
  name: 'Oracle PCM Deploy Cube',
  description:
    'Deploy or redeploy the PCM calculation cube immediately. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    isKeepData: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Preserve existing cube data; cannot combine with isReplaceCube',
      default: false,
    },
    isReplaceCube: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Replace the existing cube; cannot combine with isKeepData',
      default: false,
    },
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment for the operation',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
