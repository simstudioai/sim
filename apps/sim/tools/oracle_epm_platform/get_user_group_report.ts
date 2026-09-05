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

export const oracleEpmPlatformGetUserGroupReportTool: InternalToolConfig<
  OracleEpmPlatformParams<'get_user_group_report'>,
  OracleEpmPlatformResponse<'get_user_group_report'>
> = {
  id: 'oracle_epm_platform_get_user_group_report',
  name: 'Oracle EPM Platform Get User Group Report',
  description:
    'Report direct and indirect environment group memberships. Requires Service Administrator or Access Control - Manage/View with an application role.',
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
    groupname: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional group name filter',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    users: {
      type: 'array',
      description: 'Users and group memberships',
      items: {
        type: 'object',
        properties: {
          ...ORACLE_EPM_USER_PROPERTIES,
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                groupname: { type: 'string' },
                direct: {
                  type: 'boolean',
                  description: 'True for direct membership; false for indirect membership',
                },
              },
            },
          },
        },
      },
    },
  },
}
