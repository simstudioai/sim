import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmOptimizeCubeParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmOptimizeCubeTool: InternalToolConfig<
  OraclePcmOptimizeCubeParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_optimize_cube',
  name: 'Oracle PCM Optimize Cube',
  description:
    'Control query tracking or create and clear aggregate views for a PCM ASO cube. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ASO optimization operation Allowed values: clearAggregations, createAggregations, startQueryTracking, stopQueryTracking, createQBOAggregations.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_TASK_OUTPUTS,
}
