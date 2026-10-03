import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningGetDimensionParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_details.html */
export const oracleEpmPlanningGetDimensionTool: InternalToolConfig<
  OracleEpmPlanningGetDimensionParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_get_dimension',
  name: 'Oracle EPM Planning Get Dimension',
  description: 'Read a dimension hierarchy, subject to the 16 MiB response limit.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: true },
    dimension: { ...oracleEpmPlanningParamFields.dimension, required: true },
    aliasTableName: { ...oracleEpmPlanningParamFields.aliasTableName, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    dimension: {
      type: 'json',
      description: 'Dimension hierarchy',
      properties: {
        name: {
          type: 'string',
          description: 'Dimension/member name',
        },
        id: {
          type: 'string',
          description: 'id',
          optional: true,
        },
        path: {
          type: 'string',
          description: 'path',
          optional: true,
        },
        alias: {
          type: 'string',
          description: 'alias',
          optional: true,
        },
        parentName: {
          type: 'string',
          description: 'parentName',
          optional: true,
        },
        dimName: {
          type: 'string',
          description: 'dimName',
          optional: true,
        },
        dimType: {
          type: 'string',
          description: 'dimType',
          optional: true,
        },
        level: {
          type: 'number',
          description: 'Level',
          optional: true,
        },
        generation: {
          type: 'number',
          description: 'Generation',
          optional: true,
        },
        children: {
          type: 'array',
          description:
            'Recursive children with the same dimension/member fields; omitted on leaves',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Member name',
              },
              id: {
                type: 'string',
                description: 'Member ID',
                optional: true,
              },
              path: {
                type: 'string',
                description: 'Member path',
                optional: true,
              },
              parentName: {
                type: 'string',
                description: 'Parent name',
                optional: true,
              },
            },
          },
          optional: true,
        },
      },
    },
  },
}
