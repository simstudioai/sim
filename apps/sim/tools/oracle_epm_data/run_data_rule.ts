import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataJobResponse,
  OracleEpmDataRunDataRuleParams,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataRunDataRuleTool: InternalToolConfig<
  OracleEpmDataRunDataRuleParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_run_data_rule',
  name: 'Oracle EPM Data Run Data Rule',
  description:
    'Execute an existing Data Management load rule with explicit period and import/export modes.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    jobName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing Data Management data load rule name',
    },
    startPeriod: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'First period defined in Data Management period mapping',
    },
    endPeriod: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Last period defined in Data Management period mapping',
    },
    importMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'APPEND, REPLACE, RECALCULATE, or NONE',
    },
    exportMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Planning: STORE_DATA, ADD_DATA, SUBTRACT_DATA, REPLACE_DATA, NONE. FCCS/Tax: REPLACE, MERGE, NONE.',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Optional inbox source file; omission uses the data rule's configured filename",
    },
    waitForCompletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Wait up to five minutes for this documented job to finish; default false. Timeout preserves the job ID and never resubmits.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_JOB_OUTPUTS,
}
