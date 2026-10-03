import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_BATCH_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformCreateGroupsTool: InternalToolConfig<
  OracleEpmPlatformParams<'create_groups'>,
  OracleEpmPlatformResponse<'create_groups'>
> = {
  id: 'oracle_epm_platform_create_groups',
  name: 'Oracle EPM Platform Create Groups',
  description:
    'Create EPM groups and optionally add existing user/group members. Requires Service Administrator or Access Control - Manage with an application role. Nested member failures are returned.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
    groups: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      minItems: 1,
      maxItems: 1000,
      description: 'EPM groups to create',
      items: {
        type: 'object',
        required: ['groupname'],
        additionalProperties: false,
        properties: {
          groupname: {
            type: 'string',
          },
          description: {
            type: 'string',
          },
          members: {
            type: 'object',
            additionalProperties: false,
            properties: {
              users: {
                type: 'array',
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
                maxItems: 1000,
              },
              groups: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['groupname'],
                  additionalProperties: false,
                  properties: {
                    groupname: {
                      type: 'string',
                      description: 'Group name',
                    },
                  },
                },
                maxItems: 1000,
              },
            },
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
