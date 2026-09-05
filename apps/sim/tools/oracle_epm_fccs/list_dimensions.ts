import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsListDimensionsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_plan_types.html */
export const oracleEpmFccsListDimensionsTool: InternalToolConfig<
  FccsListDimensionsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_list_dimensions',
  name: 'Oracle EPM FCCS List Dimensions',
  description: 'List one bounded page of cube dimensions, with optional Oracle dimension filters.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    cube: fccsParamFields.cube,
    offset: { ...fccsParamFields.offset, required: false },
    limit: { ...fccsParamFields.limit, required: false },
    filter: { ...fccsParamFields.filter, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of dimensions',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Dimension ID',
          },
          name: {
            type: 'string',
            description: 'Dimension name',
          },
          dimType: {
            type: 'string',
            description: 'Dimension type',
            optional: true,
          },
          objectType: {
            type: 'string',
            description: 'Object type',
            optional: true,
          },
          level: {
            type: 'number',
            description: 'Hierarchy level',
            optional: true,
          },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total matching dimensions',
    },
    hasMore: {
      type: 'boolean',
      description: 'More pages exist',
    },
  },
}
