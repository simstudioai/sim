import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformAssignRoleTool: InternalToolConfig<
  OracleEpmPlatformParams<'assign_role'>,
  OracleEpmPlatformResponse<'assign_role'>
> = {
  id: 'oracle_epm_platform_assign_role',
  name: 'Oracle EPM Platform Assign Role',
  description:
    'Assign an application or granular role to existing users. Application roles require Service Administrator, or Identity Domain Administrator plus an application role. Granular roles require Service Administrator, or an application role plus Access Control - Manage.',
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
