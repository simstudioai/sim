import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningRunRulesetParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/ruleset.html */
export const oracleEpmPlanningRunRulesetTool: InternalToolConfig<
  OracleEpmPlanningRunRulesetParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_run_ruleset',
  name: 'Oracle EPM Planning Run Ruleset',
  description:
    'Run a deployed ruleset with runtime prompts. Hidden prompt defaults take precedence over supplied values.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    jobName: { ...oracleEpmPlanningParamFields.jobName, required: true },
    parameters: { ...oracleEpmPlanningParamFields.parameters, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    job: {
      type: 'json',
      description: 'Planning job snapshot',
      properties: {
        jobId: {
          type: 'number',
          description: 'Job ID',
        },
        status: {
          type: 'number',
          description:
            '-1 processing; 0 success; 1 error; 2 cancel pending; 3 cancelled; 4 invalid parameter; other values are not success',
        },
        details: {
          type: 'string',
          description: 'Job details',
          nullable: true,
        },
        jobName: {
          type: 'string',
          description: 'Job name',
        },
        descriptiveStatus: {
          type: 'string',
          description: 'Human-readable status',
          nullable: true,
        },
        detailedStatus: {
          type: 'number',
          description: 'Detailed Oracle status',
          optional: true,
        },
      },
    },
  },
}
