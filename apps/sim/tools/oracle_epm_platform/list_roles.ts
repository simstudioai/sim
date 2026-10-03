import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformListRolesTool: InternalToolConfig<
  OracleEpmPlatformParams<'list_roles'>,
  OracleEpmPlatformResponse<'list_roles'>
> = {
  id: 'oracle_epm_platform_list_roles',
  name: 'Oracle EPM Platform List Roles',
  description:
    'List available application and granular roles for this EPM product. Requires Service Administrator or Access Control - Manage with an application role. Role names are product-specific.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional role type: application or granular; omit for both',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    roles: {
      type: 'array',
      description: 'Available roles',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Role name used by Assign Role and Unassign Role' },
          id: { type: 'string', description: 'Provider role identifier' },
        },
      },
    },
  },
}
