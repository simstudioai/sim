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
          action: { type: 'string', description: 'Migration action' },
          duration: { type: 'string', description: 'Provider-formatted elapsed duration' },
          status: { type: 'string', description: 'Provider migration status text' },
          user: { type: 'string', description: 'User who initiated the migration' },
          snapshot: { type: 'string', description: 'Migration snapshot name' },
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
            description:
              'Component migration summaries; undocumented error details are not returned',
            items: {
              type: 'object',
              properties: {
                destination: { type: 'string', description: 'Destination component' },
                source: { type: 'string', description: 'Source component' },
                status: { type: 'string', description: 'Component migration status text' },
                errorCount: { type: 'number', description: 'Number of reported errors' },
                warningCount: { type: 'number', description: 'Number of reported warnings' },
              },
            },
          },
        },
      },
    },
  },
}
