import { z } from 'zod'
import {
  PLANETSCALE_BACKUP_OUTPUT_PROPERTIES,
  PLANETSCALE_PAGINATION_OUTPUT,
  type PlanetScaleBackup,
  type PlanetScaleListBackupsParams,
  type PlanetScalePagination,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  optionalPlanetScaleBoolean,
  optionalPlanetScaleEnum,
  optionalPlanetScaleInteger,
  optionalPlanetScaleString,
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleBackupSchema,
  planetScaleHeaders,
  planetScaleJson,
  planetScalePaginationSchema,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleListBackupsTool: ToolConfig<
  PlanetScaleListBackupsParams,
  PlanetScaleToolResponse<{ backups: PlanetScaleBackup[]; pagination: PlanetScalePagination }>
> = {
  id: 'planetscale_list_backups',
  name: 'PlanetScale List Backups',
  description: 'List backups',
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
    all: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include all backups, including deleted ones',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter backups by state',
    },
    policy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter backups by backup policy ID',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter backups started after this date (e.g. 2023-01-01T00:00:00Z)',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter backups started before this date (e.g. 2023-01-31T23:59:59Z)',
    },
    runningAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter backups that are running during a specific time (e.g. 2023-01-01T00:00:00Z..2023-01-01T23:59:59Z)',
    },
    production: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter backups by production branch',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'If provided, specifies the page offset of returned results',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'If provided, specifies the number of returned results',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}/branches/${safeUrlPathSegment(params.branch, 'branch')}/backups`,
        {
          all: optionalPlanetScaleBoolean(params.all, 'all'),
          state: optionalPlanetScaleEnum(params.state, 'state', [
            'pending',
            'running',
            'success',
            'failed',
            'canceled',
            'ignored',
          ]),
          policy: optionalPlanetScaleString(params.policy, 'policy'),
          from: optionalPlanetScaleString(params.from, 'from'),
          to: optionalPlanetScaleString(params.to, 'to'),
          running_at: optionalPlanetScaleString(params.runningAt, 'runningAt'),
          production: optionalPlanetScaleBoolean(params.production, 'production'),
          page: optionalPlanetScaleInteger(params.page, 'page'),
          per_page: optionalPlanetScaleInteger(params.perPage, 'perPage'),
        }
      ),
    method: 'GET',
    headers: planetScaleHeaders,
    retry: PLANETSCALE_READ_RETRY,
  },
  transformResponse: async (response) => {
    const data = await planetScaleJson(response)
    const resources = z.object({ data: z.array(planetScaleBackupSchema) }).parse(data)
    return {
      success: true,
      output: { backups: resources.data, pagination: planetScalePaginationSchema.parse(data) },
    }
  },
  outputs: {
    backups: {
      type: 'array',
      description: 'backups',
      items: { type: 'object', properties: PLANETSCALE_BACKUP_OUTPUT_PROPERTIES },
    },
    pagination: PLANETSCALE_PAGINATION_OUTPUT,
  },
}
