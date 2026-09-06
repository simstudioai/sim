import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningChangePlanningUnitStatusParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/change_planning_unit_status.html */
export const oracleEpmPlanningChangePlanningUnitStatusTool: InternalToolConfig<
  OracleEpmPlanningChangePlanningUnitStatusParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_change_planning_unit_status',
  name: 'Oracle EPM Planning Change Planning Unit Status',
  description:
    'Perform one explicitly chosen approval action. Service Administrator required; units must be owned by the caller and have compatible hierarchy levels and statuses. May change status or ownership; no automatic preflight or retry.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    puhIdentifier: { ...oracleEpmPlanningParamFields.puhIdentifier, required: true },
    pmMembers: { ...oracleEpmPlanningParamFields.pmMembers, required: true },
    actionId: { ...oracleEpmPlanningParamFields.actionId, required: true },
    comments: { ...oracleEpmPlanningParamFields.comments, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    planningUnitAction: {
      type: 'json',
      description: 'Oracle confirmation returned in self-link data, not a job snapshot',
      properties: {
        pmMembers: {
          type: 'string',
          description: 'pmMembers',
        },
        action: {
          type: 'string',
          description: 'action',
        },
        comments: {
          type: 'string',
          description: 'comments',
        },
      },
    },
  },
}
