import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningDeleteSubstitutionVariableParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_del_a_subst_variable_for_app.html */
export const oracleEpmPlanningDeleteSubstitutionVariableTool: InternalToolConfig<
  OracleEpmPlanningDeleteSubstitutionVariableParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_delete_substitution_variable',
  name: 'Oracle EPM Planning Delete Substitution Variable',
  description:
    'Delete one substitution variable at application or cube scope. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    variableName: { ...oracleEpmPlanningParamFields.variableName, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Deletion completed',
    },
  },
}
