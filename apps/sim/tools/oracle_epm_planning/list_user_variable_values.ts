import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningListUserVariableValuesParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_user_variables_for_app.html */
export const oracleEpmPlanningListUserVariableValuesTool: InternalToolConfig<
  OracleEpmPlanningListUserVariableValuesParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_user_variable_values',
  name: 'Oracle EPM Planning List User Variable Values',
  description: 'Read one bounded page of user-variable values. Administrators can read all users; other users can read their own. No completion indicator is provided by Oracle.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    offset: { ...oracleEpmPlanningParamFields.offset, required: false },
    limit: { ...oracleEpmPlanningParamFields.limit, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    userVariableValues: {
      type: 'array',
      description: 'One page of user-variable values; Oracle provides no completion flag',
      items: {
        type: 'object',
        properties: {
          userName: {
            type: 'string',
            description: 'userName',
          },
          name: {
            type: 'string',
            description: 'name',
          },
          dimension: {
            type: 'string',
            description: 'dimension',
          },
          member: {
            type: 'string',
            description: 'member',
          },
        },
      },
    },
  },
}
