import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformDeleteUsersTool: InternalToolConfig<
  OracleEpmPlatformParams<'delete_users'>,
  OracleEpmPlatformResponse<'delete_users'>
> = {
  id: 'oracle_epm_platform_delete_users',
  name: 'Oracle EPM Platform Delete Users',
  description:
    'Remove users from the identity domain, affecting every environment in that domain. Requires Identity Domain Administrator and an application role. Inspect per-user failures.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
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
