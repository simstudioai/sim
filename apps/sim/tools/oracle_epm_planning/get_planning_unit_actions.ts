import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningGetPlanningUnitActionsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_available_planning_unit_actions.html */
export const oracleEpmPlanningGetPlanningUnitActionsTool: InternalToolConfig<
  OracleEpmPlanningGetPlanningUnitActionsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_get_planning_unit_actions',
  name: 'Oracle EPM Planning Get Planning Unit Actions',
  description:
    'List available approval actions for units owned by the requesting Service Administrator. Does not change ownership or status.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    puhIdentifier: { ...oracleEpmPlanningParamFields.puhIdentifier, required: true },
    pmMembers: { ...oracleEpmPlanningParamFields.pmMembers, required: true },
    approvalOptions: { ...oracleEpmPlanningParamFields.approvalOptions, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    planningUnitActions: {
      type: 'array',
      description: 'Available actions without performing any transition',
      items: {
        type: 'object',
        properties: {
          actionId: {
            type: 'number',
            description: 'Action ID',
          },
          name: {
            type: 'string',
            description: 'Action name',
          },
        },
      },
    },
  },
}
