import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformUnassignRoleTool: InternalToolConfig<
  OracleEpmPlatformParams<'unassign_role'>,
  OracleEpmPlatformResponse<'unassign_role'>
> = {
  id: 'oracle_epm_platform_unassign_role',
  name: 'Oracle EPM Platform Unassign Role',
  description:
    'Unassign an application or granular role from users. Application roles require Service Administrator, or Identity Domain Administrator plus an application role. Granular roles require Service Administrator, or an application role plus Access Control - Manage.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    rolename: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Available product-specific application or granular role name',
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
