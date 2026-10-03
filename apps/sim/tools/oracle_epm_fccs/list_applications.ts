import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsListApplicationsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_applications.html */
export const oracleEpmFccsListApplicationsTool: InternalToolConfig<
  FccsListApplicationsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_list_applications',
  name: 'Oracle EPM FCCS List Applications',
  description:
    'List applications visible to the Oracle EPM credential. Choose an FCCS application; application types are tenant-dependent.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Applications assigned to the credential; select an FCCS application',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Application name',
          },
          type: {
            type: 'string',
            description: 'Oracle application type code',
            optional: true,
          },
          appType: {
            type: 'string',
            description: 'Oracle business-process type label; no fixed enum is assumed',
            optional: true,
          },
          appStorage: {
            type: 'string',
            description: 'Oracle application storage label',
            optional: true,
          },
        },
      },
    },
  },
}
