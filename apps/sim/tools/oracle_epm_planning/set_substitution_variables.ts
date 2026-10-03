import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningSetSubstitutionVariablesParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_create_or_replace_all_subst_variables_for_app_3.html */
export const oracleEpmPlanningSetSubstitutionVariablesTool: InternalToolConfig<
  OracleEpmPlanningSetSubstitutionVariablesParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_set_substitution_variables',
  name: 'Oracle EPM Planning Set Substitution Variables',
  description:
    'Create or update the supplied substitution variables; other variables are unchanged. Use planType ALL for application scope.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    variables: { ...oracleEpmPlanningParamFields.variables, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    updated: {
      type: 'boolean',
      description: 'All supplied variables were accepted',
    },
  },
}
