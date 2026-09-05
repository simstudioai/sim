import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import {
  ORACLE_EPM_ASSIGNED_ROLE_PROPERTIES,
  ORACLE_EPM_GROUP_SUMMARY_PROPERTIES,
  ORACLE_EPM_STATUS_OUTPUTS,
  ORACLE_EPM_USER_PROPERTIES,
} from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformListUsersTool: InternalToolConfig<
  OracleEpmPlatformParams<'list_users'>,
  OracleEpmPlatformResponse<'list_users'>
> = {
  id: 'oracle_epm_platform_list_users',
  name: 'Oracle EPM Platform List Users',
  description:
    'List environment users, optionally including their groups and roles. Requires Service Administrator or Access Control - Manage/View with an application role. Oracle documents no pagination.',
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
    epmgroups: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include EPM groups',
    },
    idcsgroups: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include IDCS groups',
    },
    granularroles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include granular roles',
    },
    applicationroles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include application roles',
    },
    indirect: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include indirect as well as direct associations',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    users: {
      type: 'array',
      description: 'Environment users and requested associations',
      items: {
        type: 'object',
        properties: {
          ...ORACLE_EPM_USER_PROPERTIES,
          epmgroups: {
            type: 'array',
            optional: true,
            items: { type: 'object', properties: ORACLE_EPM_GROUP_SUMMARY_PROPERTIES },
          },
          idcsgroups: {
            type: 'array',
            optional: true,
            items: { type: 'object', properties: ORACLE_EPM_GROUP_SUMMARY_PROPERTIES },
          },
          granularroles: {
            type: 'array',
            optional: true,
            items: { type: 'object', properties: ORACLE_EPM_ASSIGNED_ROLE_PROPERTIES },
          },
          applicationroles: {
            type: 'array',
            optional: true,
            items: { type: 'object', properties: ORACLE_EPM_ASSIGNED_ROLE_PROPERTIES },
          },
        },
      },
    },
  },
}
