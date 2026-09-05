import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningSetUserVariableValuesParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_set_user_variables.html */
export const oracleEpmPlanningSetUserVariableValuesTool: InternalToolConfig<
  OracleEpmPlanningSetUserVariableValuesParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_set_user_variable_values',
  name: 'Oracle EPM Planning Set User Variable Values',
  description:
    'Set a batch of user-variable values, distinct from substitution variables. Administrators can update other users; non-administrators can update their own values. Oracle does not guarantee transactional batch behavior.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    userVariableValues: { ...oracleEpmPlanningParamFields.userVariableValues, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    updated: {
      type: 'boolean',
      description:
        'Oracle returned HTTP 204 for the update request; no per-item results or atomicity guarantee',
    },
  },
}
