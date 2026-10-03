import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformAddUsersToGroupTool: InternalToolConfig<
  OracleEpmPlatformParams<'add_users_to_group'>,
  OracleEpmPlatformResponse<'add_users_to_group'>
> = {
  id: 'oracle_epm_platform_add_users_to_group',
  name: 'Oracle EPM Platform Add Users to Group',
  description:
    'Add existing users to an EPM group. Requires Service Administrator or Access Control - Manage with an application role.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    groupname: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing EPM group name',
    },
    users: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      minItems: 1,
      maxItems: 1000,
      description:
        'Users to process (1–1,000); inspect failed and failedItems for partial failures',
      items: {
        type: 'object',
        required: ['userlogin'],
        additionalProperties: false,
        properties: {
          userlogin: {
            type: 'string',
            description: 'User login',
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
