import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformListFilesTool: InternalToolConfig<
  OracleEpmPlatformParams<'list_files'>,
  OracleEpmPlatformResponse<'list_files'>
> = {
  id: 'oracle_epm_platform_list_files',
  name: 'Oracle EPM Platform List Files',
  description:
    'List repository files and Migration snapshots with documented sizes and timestamps. LCM sizes are unavailable. Requires Service Administrator or Migrations - Administer with an application role.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    files: {
      type: 'array',
      description: 'Repository files and snapshots',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Exact repository filename or snapshot name returned by Oracle',
          },
          type: { type: 'string', description: 'LCM or EXTERNAL' },
          size: { type: 'number', nullable: true, description: 'Bytes; null for LCM snapshots' },
          lastModifiedTime: {
            type: 'number',
            nullable: true,
            description: 'Unix epoch milliseconds; null for LCM snapshots',
          },
        },
      },
    },
  },
}
