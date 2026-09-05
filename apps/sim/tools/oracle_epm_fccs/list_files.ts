import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsListFilesParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_files_v2.html */
export const oracleEpmFccsListFilesTool: InternalToolConfig<FccsListFilesParams, FccsResponse> = {
  id: 'oracle_epm_fccs_list_files',
  name: 'Oracle EPM FCCS List Files',
  description:
    'List external Oracle repository files with documented sizes and timestamps; excludes LCM snapshots.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    status: {
      type: 'number',
      description: 'Repository listing status',
    },
    details: {
      type: 'string',
      description: 'Oracle status details',
      optional: true,
      nullable: true,
    },
    items: {
      type: 'array',
      description: 'External repository files only; excludes LCM snapshots',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Repository filename/path',
          },
          type: {
            type: 'string',
            description: 'EXTERNAL',
          },
          size: {
            type: 'string',
            description: 'Size in bytes as an Oracle decimal string, or null when unavailable',
            nullable: true,
          },
          lastmodifiedtime: {
            type: 'string',
            description:
              'Milliseconds since Unix epoch as an Oracle decimal string, or null when unavailable',
            nullable: true,
          },
        },
      },
    },
  },
}
