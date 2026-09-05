import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformDeleteGroupsTool: InternalToolConfig<
  OracleEpmPlatformParams<'delete_groups'>,
  OracleEpmPlatformResponse<'delete_groups'>
> = {
  id: 'oracle_epm_platform_delete_groups',
  name: 'Oracle EPM Platform Delete Groups',
  description:
    'Delete EPM groups. Requires Service Administrator or Access Control - Manage with an application role. Inspect per-group failures.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    groups: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      minItems: 1,
      maxItems: 1000,
      description: 'Existing EPM groups to delete',
      items: {
        type: 'object',
        required: ['groupname'],
        additionalProperties: false,
        properties: {
          groupname: {
            type: 'string',
            description: 'Group name',
          },
        },
      },
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_BATCH_OUTPUTS,
  },
}
