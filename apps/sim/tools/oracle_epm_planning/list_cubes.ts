import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningListCubesParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_plan_types.html */
export const oracleEpmPlanningListCubesTool: InternalToolConfig<
  OracleEpmPlanningListCubesParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_cubes',
  name: 'Oracle EPM Planning List Cubes',
  description: 'List the application’s plan types (cubes).',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    cubes: {
      type: 'array',
      description: 'Application cubes',
      items: {
        type: 'object',
        properties: {
          planTypeName: {
            type: 'string',
            description: 'Cube selector value',
          },
          planType: {
            type: 'number',
            description: 'Plan type ID',
          },
          cubeName: {
            type: 'string',
            description: 'Essbase cube name',
          },
          numDimensions: {
            type: 'number',
            description: 'Dimension count',
          },
          cubeType: {
            type: 'number',
            description: 'Oracle cube type',
          },
        },
      },
    },
  },
}
