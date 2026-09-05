import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import {
  ORACLE_EPM_STATUS_OUTPUTS,
  ORACLE_EPM_USER_PROPERTIES,
} from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformGetRoleAssignmentsTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_role_assignments'>,
  OracleEpmPlatformResponse<'get_role_assignments'>
> = {
  id: 'oracle_epm_platform_get_role_assignments',
  name: 'Oracle EPM Platform Get Role Assignments',
  description:
    'Get environment role assignments. A report filtered to one user can lag recent changes; omit userlogin for updated all-user data. Requires Service Administrator or Access Control - Manage/View with an application role.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    userlogin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional matching user login',
    },
    userattribute: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Match login, first name, last name, or email (case-insensitive)',
    },
    rolename: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional application or granular role name filter',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    assignments: {
      type: 'array',
      description: 'Users and their role assignments',
      items: {
        type: 'object',
        properties: {
          ...ORACLE_EPM_USER_PROPERTIES,
          roles: {
            type: 'array',
            description: 'Role assignments for this user',
            items: {
              type: 'object',
              properties: {
                rolename: { type: 'string', description: 'Assigned role name' },
                roletype: { type: 'string', description: 'Application or Granular' },
                grantedthroughgroup: {
                  type: 'string',
                  description: 'Granting group path; empty for direct assignments',
                },
              },
            },
          },
        },
      },
    },
  },
}
