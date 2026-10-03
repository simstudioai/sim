import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningAddMemberParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/add_member.html */
export const oracleEpmPlanningAddMemberTool: InternalToolConfig<
  OracleEpmPlanningAddMemberParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_add_member',
  name: 'Oracle EPM Planning Add Member',
  description:
    'Add a dynamic member. The parent must allow dynamic children and the cube must already have been refreshed. Requires Service Administrator; no implicit refresh.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    dimension: { ...oracleEpmPlanningParamFields.dimension, required: true },
    memberName: { ...oracleEpmPlanningParamFields.memberName, required: true },
    parentName: { ...oracleEpmPlanningParamFields.parentName, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    member: {
      type: 'json',
      description: 'Member metadata',
      properties: {
        name: {
          type: 'string',
          description: 'Member name',
        },
        description: {
          type: 'string',
          description: 'Description',
          nullable: true,
        },
        parentName: {
          type: 'string',
          description: 'Parent name',
          nullable: true,
        },
        dimName: {
          type: 'string',
          description: 'Dimension name',
        },
        dataType: {
          type: 'string',
          description: 'Data type',
          optional: true,
        },
        dataStorage: {
          type: 'string',
          description: 'Storage type',
        },
        objectType: {
          type: 'number',
          description: 'Oracle object type',
        },
        twoPass: {
          type: 'boolean',
          description: 'Two-pass calculation',
        },
      },
    },
  },
}
