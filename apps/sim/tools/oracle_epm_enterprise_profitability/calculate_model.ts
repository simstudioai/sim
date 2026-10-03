import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmCalculateModelParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmCalculateModelTool: InternalToolConfig<
  OracleEpcmCalculateModelParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_calculate_model',
  name: 'Oracle EPCM Calculate Model',
  description:
    'Execute allocations in an existing EPCM model. Submission is separate from waiting; never blindly retry after an ambiguous failure.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,

    applicationName: {
      type: 'string',
      required: true,
      description: 'Exact EPCM application name',
      visibility: 'user-or-llm',
    },
    jobName: {
      type: 'string',
      required: true,
      description: 'Calculation/report/POV job label; an existing saved job is not required',
      visibility: 'user-or-llm',
    },
    modelName: {
      type: 'string',
      required: true,
      description: "Existing EPCM model name; use the tenant's exact name",
      visibility: 'user-or-llm',
    },
    povDelimiter: {
      type: 'string',
      required: false,
      description: 'Explicit single-character POV delimiter: _, #, ~, %, ;, :, or -',
      default: ':',
      visibility: 'user-or-llm',
    },
    povName: {
      type: 'string',
      required: true,
      description:
        'POV members joined with the delimiter; calculations also accept comma-separated POVs',
      visibility: 'user-or-llm',
    },
    executionType: {
      type: 'string',
      required: false,
      description:
        'Calculation execution scope. Allowed values: ALL_RULES, RULESET_SUBSET, SINGLE_RULE, RUN_FROM_RULE, STOP_AFTER_RULE.',
      default: 'ALL_RULES',
      visibility: 'user-or-llm',
    },
    ruleName: {
      type: 'string',
      required: false,
      description: 'Required for SINGLE_RULE, RUN_FROM_RULE, or STOP_AFTER_RULE',
      visibility: 'user-or-llm',
    },
    rulesetSeqNumStart: {
      type: 'number',
      required: false,
      description: 'Required first rule-set sequence for RULESET_SUBSET',
      visibility: 'user-or-llm',
    },
    rulesetSeqNumEnd: {
      type: 'number',
      required: false,
      description: 'Required last rule-set sequence for RULESET_SUBSET',
      visibility: 'user-or-llm',
    },
    clearCalculatedData: {
      type: 'boolean',
      required: false,
      description: 'Clear previously calculated data',
      default: false,
      visibility: 'user-or-llm',
    },
    executeCalculations: {
      type: 'boolean',
      required: false,
      description: 'Execute calculations; Sim explicitly defaults to true',
      default: true,
      visibility: 'user-or-llm',
    },
    optimizeForReporting: {
      type: 'boolean',
      required: false,
      description: 'Optimize results for reporting',
      default: false,
      visibility: 'user-or-llm',
    },
    captureDebugScripts: {
      type: 'boolean',
      required: false,
      description: 'Capture debug scripts',
      default: false,
      visibility: 'user-or-llm',
    },
    comment: {
      type: 'string',
      required: false,
      description: 'Optional calculation comment',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
