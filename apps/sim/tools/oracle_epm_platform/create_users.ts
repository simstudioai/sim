import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformCreateUsersTool: InternalToolConfig<
  OracleEpmPlatformParams<'create_users'>,
  OracleEpmPlatformResponse<'create_users'>
> = {
  id: 'oracle_epm_platform_create_users',
  name: 'Oracle EPM Platform Create Users',
  description:
    'Create users in the identity domain, not just this environment. Requires Identity Domain Administrator and an application role. Password-bearing input is operator-controlled; passwords are never returned. Inspect batch failures.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    users: {
      type: 'array',
      required: true,
      visibility: 'user-only',
      minItems: 1,
      maxItems: 1000,
      description:
        'Operator-provided users. Omit password for Oracle-assigned passwords; resetpassword is required. First name may be omitted or empty.',
      items: {
        type: 'object',
        required: ['userlogin', 'lastname', 'email', 'resetpassword'],
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
          password: {
            type: 'string',
          },
          resetpassword: {
            type: 'boolean',
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
