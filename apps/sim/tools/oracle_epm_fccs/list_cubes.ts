import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsListCubesParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_plan_types.html */
export const oracleEpmFccsListCubesTool: InternalToolConfig<FccsListCubesParams, FccsResponse> = {
  id: 'oracle_epm_fccs_list_cubes',
  name: 'Oracle EPM FCCS List Cubes',
  description: 'List the cubes (plan types) in an FCCS application.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Application cubes',
      items: {
        type: 'object',
        properties: {
          planTypeName: {
            type: 'string',
            description: 'Value used as cube input',
          },
          cubeName: {
            type: 'string',
            description: 'Cube display name',
            optional: true,
          },
          planType: {
            type: 'number',
            description: 'planType',
            optional: true,
          },
          numDimensions: {
            type: 'number',
            description: 'numDimensions',
            optional: true,
          },
          cubeType: {
            type: 'number',
            description: 'cubeType',
            optional: true,
          },
        },
      },
    },
  },
}
