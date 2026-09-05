import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import {
  ORACLE_EPM_ASSIGNED_ROLE_PROPERTIES,
  ORACLE_EPM_GROUP_MEMBERS_PROPERTIES,
  ORACLE_EPM_GROUP_SUMMARY_PROPERTIES,
  ORACLE_EPM_STATUS_OUTPUTS,
} from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformListGroupsTool: InternalToolConfig<
  OracleEpmPlatformParams<'list_groups'>,
  OracleEpmPlatformResponse<'list_groups'>
> = {
  id: 'oracle_epm_platform_list_groups',
  name: 'Oracle EPM Platform List Groups',
  description:
    'List environment groups and optionally members and roles. Requires Service Administrator or Access Control - Manage/View with an application role. No type filter is sent.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    groupname: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional matching group name',
    },
    members: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include group and user members',
    },
    roles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include assigned granular roles',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    groups: {
      type: 'array',
      description: 'Available environment groups',
      items: {
        type: 'object',
        properties: {
          ...ORACLE_EPM_GROUP_SUMMARY_PROPERTIES,
          identity: { type: 'string', description: 'Opaque provider identity; not a URL to fetch' },
          members: {
            type: 'object',
            optional: true,
            description: 'Requested user and group memberships',
            properties: ORACLE_EPM_GROUP_MEMBERS_PROPERTIES,
          },
          roles: {
            type: 'array',
            optional: true,
            description: 'Requested granular role assignments',
            items: { type: 'object', properties: ORACLE_EPM_ASSIGNED_ROLE_PROPERTIES },
          },
        },
      },
    },
  },
}
