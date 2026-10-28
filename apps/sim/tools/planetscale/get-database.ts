import {
  PLANETSCALE_DATABASE_OUTPUT_PROPERTIES,
  type PlanetScaleDatabase,
  type PlanetScaleGetDatabaseParams,
  type PlanetScaleToolResponse,
} from '@/tools/planetscale/types'
import {
  PLANETSCALE_READ_RETRY,
  planetScaleApiUrl,
  planetScaleDatabaseSchema,
  planetScaleHeaders,
  planetScaleJson,
} from '@/tools/planetscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
export const planetScaleGetDatabaseTool: ToolConfig<
  PlanetScaleGetDatabaseParams,
  PlanetScaleToolResponse<{ database: PlanetScaleDatabase }>
> = {
  id: 'planetscale_get_database',
  name: 'PlanetScale Get Database',
  description: 'Get a database',
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
      description: 'Database name slug from `list_databases`. Example: `app-db`.',
    },
  },
  request: {
    url: (params) =>
      planetScaleApiUrl(
        `/organizations/${safeUrlPathSegment(params.organization, 'organization')}/databases/${safeUrlPathSegment(params.database, 'database')}`,
        {}
      ),
    method: 'GET',
    headers: planetScaleHeaders,
    retry: PLANETSCALE_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: { database: planetScaleDatabaseSchema.parse(await planetScaleJson(response)) },
  }),
  outputs: {
    database: {
      type: 'json',
      description: 'Database details',
      properties: PLANETSCALE_DATABASE_OUTPUT_PROPERTIES,
    },
  },
}
