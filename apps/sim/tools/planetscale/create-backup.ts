import {
  PLANETSCALE_BACKUP_OUTPUT_PROPERTIES,
  type PlanetScaleBackup,
  type PlanetScaleCreateBackupParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleBoolean,
  optionalPlanetScaleEnum,
  optionalPlanetScaleInteger,
  optionalPlanetScaleString,
  planetScaleApiUrl,
  planetScaleBackupSchema,
  planetScaleBody,
  planetScaleHeaders,
  planetScaleJson,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleCreateBackupTool: ToolConfig<
  PlanetScaleCreateBackupParams,
  PlanetScaleToolResponse<{ backup: PlanetScaleBackup }>
> = {
  id: 'planetscale_create_backup',
  name: 'PlanetScale Create Backup',
  description: 'Create a backup',
  version: '1.0.0',
  params: {
    serviceTokenId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlanetScale service token ID',
    },
    serviceToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PlanetScale service token secret',
    },
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PlanetScale organization slug',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the database the branch belongs to',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the branch',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the backup',
    },
    retentionUnit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit for the retention period of the backup',
    },
    retentionValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Value between `1` and `1000` for the retention period of the backup (i.e retention_value `6` and retention_unit `hour` means 6 hours)',
    },
    emergency: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the backup is an immediate backup that may affect database performance. Emergency backups are only supported for PostgreSQL databases.',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/branches/${safeUrlPathSegment(params.branch, 'branch')}/backups`,
        {}
      ),
    method: 'POST',
    headers: planetScaleHeaders,
    body: (params) =>
      planetScaleBody({
        name: optionalPlanetScaleString(params.name, 'name'),
        retention_unit: optionalPlanetScaleEnum(params.retentionUnit, 'retentionUnit', [
          'hour',
          'day',
          'week',
          'month',
          'year',
        ]),
        retention_value: optionalPlanetScaleInteger(
          params.retentionValue,
          'retentionValue',
          1,
          1000
        ),
        emergency: optionalPlanetScaleBoolean(params.emergency, 'emergency'),
      }),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { backup: planetScaleBackupSchema.parse(await planetScaleJson(response)) },
  }),
  outputs: {
    backup: {
      type: 'json',
      description: 'Backup details',
      properties: PLANETSCALE_BACKUP_OUTPUT_PROPERTIES,
    },
  },
}
