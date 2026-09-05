import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformUpdateUsersTool: InternalToolConfig<
  OracleEpmPlatformParams<'update_users'>,
  OracleEpmPlatformResponse<'update_users'>
> = {
  id: 'oracle_epm_platform_update_users',
  name: 'Oracle EPM Platform Update Users',
  description:
    'Update identity-domain users. Changes affect every environment in that identity domain. Requires Identity Domain Administrator and an application role. Password changes are not supported by this operation.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    users: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      minItems: 1,
      maxItems: 1000,
      description: 'Users with a login and at least one attribute to update',
      items: {
        type: 'object',
        required: ['userlogin'],
        additionalProperties: false,
        properties: {
          userlogin: {
            type: 'string',
          },
          firstname: {
            type: 'string',
          },
          lastname: {
            type: 'string',
          },
          email: {
            type: 'string',
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
