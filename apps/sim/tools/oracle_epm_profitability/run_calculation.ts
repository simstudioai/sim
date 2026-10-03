import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmResponse,
  OraclePcmRunCalculationParams,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_TASK_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmRunCalculationTool: InternalToolConfig<
  OraclePcmRunCalculationParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_run_calculation',
  name: 'Oracle PCM Run Calculation',
  description:
    'Run PCM allocations using all rules, a rule-set range, or one rule. Requires Service Administrator or Power User. Submission is separate from waiting; do not blindly retry an ambiguous failure.',
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
    exeType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Rules to execute; dataPOVName requires ALL_RULES Allowed values: ALL_RULES, RULESET_SUBSET, SINGLE_RULE.',
      default: 'ALL_RULES',
    },
    dataPOVName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional different data POV; requires ALL_RULES',
    },
    isClearCalculated: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Clear previously calculated data',
      default: false,
    },
    optimizeReporting: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run default aggregation after calculation',
      default: true,
    },
    subsetStart: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'First rule-set sequence; required for RULESET_SUBSET',
    },
    subsetEnd: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last rule-set sequence; required for RULESET_SUBSET',
    },
    ruleName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing rule name; required for SINGLE_RULE',
    },
    ruleSetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing rule set name; required for SINGLE_RULE',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment for the operation',
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
