import {
  type FivetranMessageResponse,
  type FivetranResyncTablesParams,
  MESSAGE_OUTPUTS,
} from '@/tools/fivetran/types'
import {
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_CONNECTION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  parseSchemaTableMap,
  transformMessageResponse,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranResyncTablesTool: ToolConfig<
  FivetranResyncTablesParams,
  FivetranMessageResponse
> = {
  id: 'fivetran_resync_tables',
  name: 'Fivetran Re-sync Tables',
  description:
    'Run a historical re-sync of specific tables in a Fivetran connection without changing its schedule.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    tables: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Tables to re-sync, as a map of schema name to table names, e.g. {"okta": ["system_log", "user"]}',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(
        `/connections/${fivetranId(params.connectionId, 'connectionId')}/schemas/tables/resync`
      ),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => {
      const tables = parseSchemaTableMap(params.tables, 'tables')
      if (!tables) throw new Error('Provide the tables to re-sync.')
      return tables
    },
  },

  transformResponse: transformMessageResponse,

  outputs: { ...MESSAGE_OUTPUTS },
}
