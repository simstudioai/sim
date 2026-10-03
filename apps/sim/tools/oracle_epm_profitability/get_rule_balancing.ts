import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmGetRuleBalancingParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_BALANCE_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmGetRuleBalancingTool: InternalToolConfig<
  OraclePcmGetRuleBalancingParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_get_rule_balancing',
  name: 'Oracle PCM Get Rule Balancing',
  description:
    'Read documented scalar rule-balancing results for a PCM POV and model view; nested rules are not exposed. Requires Service Administrator or Power User.',
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
    modelViewName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing model view to limit the data slice',
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
  outputs: ORACLE_PCM_BALANCE_OUTPUTS,
}
