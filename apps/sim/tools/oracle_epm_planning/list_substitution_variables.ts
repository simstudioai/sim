import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningListSubstitutionVariablesParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_all_subst_variables_for_app_1.html */
export const oracleEpmPlanningListSubstitutionVariablesTool: InternalToolConfig<
  OracleEpmPlanningListSubstitutionVariablesParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_substitution_variables',
  name: 'Oracle EPM Planning List Substitution Variables',
  description:
    'List application or cube substitution variables. Derived values include inherited application values when a cube is specified.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: false },
    derivedValues: { ...oracleEpmPlanningParamFields.derivedValues, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    variables: {
      type: 'array',
      description: 'Substitution variables',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Variable name',
          },
          value: {
            type: 'string',
            description: 'Variable value',
          },
          planType: {
            type: 'string',
            description: 'ALL or cube name',
          },
        },
      },
    },
  },
}
