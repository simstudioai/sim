import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningListDimensionsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_plan_types.html */
export const oracleEpmPlanningListDimensionsTool: InternalToolConfig<
  OracleEpmPlanningListDimensionsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_dimensions',
  name: 'Oracle EPM Planning List Dimensions',
  description: 'List one bounded page of dimensions for a cube.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: true },
    offset: { ...oracleEpmPlanningParamFields.offset, required: false },
    limit: { ...oracleEpmPlanningParamFields.limit, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    dimensions: {
      type: 'array',
      description: 'One page of dimension summaries',
      items: {
        type: 'object',
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
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total dimensions',
    },
    hasMore: {
      type: 'boolean',
      description: 'More dimension pages are available',
    },
  },
}
