import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningListFilesParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import { oracleEpmPlanningAuthParamFields } from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_files_v2.html */
export const oracleEpmPlanningListFilesTool: InternalToolConfig<
  OracleEpmPlanningListFilesParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_files',
  name: 'Oracle EPM Planning List Files',
  description:
    'List Oracle repository files and snapshots. Snapshot sizes may be unavailable. Requires administrator or Migration Administer permissions.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    files: {
      type: 'array',
      description: 'Repository files and snapshots',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Repository name',
          },
          type: {
            type: 'string',
            description: 'LCM or EXTERNAL',
          },
          size: {
            type: 'number',
            description: 'Byte size, unavailable for some snapshots',
            nullable: true,
          },
          lastModifiedTime: {
            type: 'number',
            description: 'Oracle last-modified timestamp',
            nullable: true,
          },
        },
      },
    },
  },
}
