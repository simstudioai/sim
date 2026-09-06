import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningGetSubstitutionVariableParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_a_subst_variable_for_app_2.html */
export const oracleEpmPlanningGetSubstitutionVariableTool: InternalToolConfig<
  OracleEpmPlanningGetSubstitutionVariableParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_get_substitution_variable',
  name: 'Oracle EPM Planning Get Substitution Variable',
  description: 'Read one application or cube substitution variable.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    variableName: { ...oracleEpmPlanningParamFields.variableName, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: false },
    derivedValues: { ...oracleEpmPlanningParamFields.derivedValues, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    variable: {
      type: 'json',
      description: 'Substitution variable',
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
}
