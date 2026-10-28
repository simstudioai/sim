import {
  PLANETSCALE_BACKUP_OUTPUT_PROPERTIES,
  type PlanetScaleBackup,
  type PlanetScaleGetBackupParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleBackupSchema,
  planetScaleHeaders,
  planetScaleJson,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleGetBackupTool: ToolConfig<
  PlanetScaleGetBackupParams,
  PlanetScaleToolResponse<{ backup: PlanetScaleBackup }>
> = {
  id: 'planetscale_get_backup',
  name: 'PlanetScale Get Backup',
  description: 'Get a backup',
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
    backupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID for the backup',
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
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/branches/${safeUrlPathSegment(params.branch, 'branch')}/backups/${safeUrlPathSegment(params.backupId, 'backupId')}`,
        {}
      ),
    method: 'GET',
    headers: planetScaleHeaders,
    retry: PLANETSCALE_READ_RETRY,
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
