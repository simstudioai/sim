import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningGetMemberParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_member.html */
export const oracleEpmPlanningGetMemberTool: InternalToolConfig<
  OracleEpmPlanningGetMemberParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_get_member',
  name: 'Oracle EPM Planning Get Member',
  description: 'Read a member by its exact name. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    dimension: { ...oracleEpmPlanningParamFields.dimension, required: true },
    memberName: { ...oracleEpmPlanningParamFields.memberName, required: true },
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
