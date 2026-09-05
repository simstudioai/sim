import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlatformParams,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'
import { ORACLE_EPM_STATUS_OUTPUTS } from '@/tools/oracle_epm_platform/types'
import { oracleEpmPlatformAuthParams } from '@/tools/oracle_epm_platform/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmPlatformListMigrationsTool: InternalToolConfig<
  OracleEpmPlatformParams<'list_migrations'>,
  OracleEpmPlatformResponse<'list_migrations'>
> = {
  id: 'oracle_epm_platform_list_migrations',
  name: 'Oracle EPM Platform List Migrations',
  description:
    'List artifact migration history and per-component error/warning counts. Requires Service Administrator. Status text is provider-defined; nested message payloads are not exposed as untyped JSON.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlatformAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...ORACLE_EPM_STATUS_OUTPUTS,
    migrations: {
      type: 'array',
      description: 'Migration history',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          duration: { type: 'string' },
          status: { type: 'string' },
          user: { type: 'string' },
          snapshot: { type: 'string' },
          startTime: {
            type: 'string',
            description: 'Provider-formatted start time; not normalized to UTC',
          },
          endTime: {
            type: 'string',
            description: 'Provider-formatted end time; not normalized to UTC',
          },
          report: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                destination: { type: 'string' },
                source: { type: 'string' },
                status: { type: 'string' },
                errorCount: { type: 'number' },
                warningCount: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
}
