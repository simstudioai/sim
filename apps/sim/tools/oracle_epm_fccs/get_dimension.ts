import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsGetDimensionParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_details.html */
export const oracleEpmFccsGetDimensionTool: InternalToolConfig<
  FccsGetDimensionParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_get_dimension',
  name: 'Oracle EPM FCCS Get Dimension',
  description:
    'Retrieve a bounded dimension hierarchy with member names, aliases, and paths. Oversized hierarchies require manual member input.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    cube: fccsParamFields.cube,
    dimension: fccsParamFields.dimension,
    aliasTableName: { ...fccsParamFields.aliasTableName, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    name: {
      type: 'string',
      description: 'Dimension name',
    },
    id: {
      type: 'string',
      description: 'Dimension ID',
      optional: true,
    },
    path: {
      type: 'string',
      description: 'Hierarchy path',
      optional: true,
    },
    alias: {
      type: 'string',
      description: 'Alias',
      optional: true,
      nullable: true,
    },
    children: {
      type: 'array',
      description: 'Recursive child hierarchy; bounded to 10,000 nodes and 64 levels',
      optional: true,
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
            description: 'Hierarchy path',
            optional: true,
          },
          alias: {
            type: 'string',
            description: 'Alias',
            optional: true,
            nullable: true,
          },
          children: {
            type: 'array',
            description: 'Further child members with the same documented shape',
            optional: true,
            items: {
              type: 'object',
            },
          },
        },
      },
    },
  },
}
