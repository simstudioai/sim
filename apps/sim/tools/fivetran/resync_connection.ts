import { filterUndefined } from '@sim/utils/object'
import {
  type FivetranMessageResponse,
  type FivetranResyncConnectionParams,
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

export const fivetranResyncConnectionTool: ToolConfig<
  FivetranResyncConnectionParams,
  FivetranMessageResponse
> = {
  id: 'fivetran_resync_connection',
  name: 'Fivetran Re-sync Connection',
  description:
    'Run a full historical re-sync of a Fivetran connection, or only of the tables listed in scope. Fivetran returns 409 if a running sync cannot finish first.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    scope: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tables to re-sync, as a map of schema name to table names, e.g. {"public": ["users", "orders"]}. Omit to re-sync every table.',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/resync`),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => filterUndefined({ scope: parseSchemaTableMap(params.scope, 'scope') }),
  },

  transformResponse: transformMessageResponse,

  outputs: { ...MESSAGE_OUTPUTS },
}
