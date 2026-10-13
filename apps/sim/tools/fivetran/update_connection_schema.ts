import { filterUndefined } from '@sim/utils/object'
import {
  type FivetranSchemaConfigResponse,
  type FivetranUpdateConnectionSchemaParams,
  SCHEMA_CONFIG_OUTPUTS,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_CONNECTION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapSchemaConfig,
  optionalBoolean,
  parseJsonObject,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranUpdateConnectionSchemaTool: ToolConfig<
  FivetranUpdateConnectionSchemaParams,
  FivetranSchemaConfigResponse
> = {
  id: 'fivetran_update_connection_schema',
  name: 'Fivetran Update Connection Schema',
  description:
    'Enable or disable syncing of one schema in a Fivetran connection, optionally changing several of its tables at once.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    schemaName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Schema name as stored in the connection schema config (case-sensitive)',
    },
    enabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the schema syncs to the destination',
    },
    tables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tables to change in this schema, keyed by table name, e.g. {"orders": {"enabled": false}}',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(
        `/connections/${fivetranId(params.connectionId, 'connectionId')}/schemas/${fivetranId(params.schemaName, 'schemaName')}`
      ),
    method: 'PATCH',
    headers: (params) => fivetranHeaders(params),
    body: (params) => {
      const enabled = optionalBoolean(params.enabled)
      if (enabled === undefined) throw new Error('Specify whether the schema is enabled.')
      return filterUndefined({ enabled, tables: parseJsonObject(params.tables, 'tables') })
    },
  },

  transformResponse: async (response: Response) => {
    return { success: true, output: mapSchemaConfig(envelopeData(await response.json())) }
  },

  outputs: { ...SCHEMA_CONFIG_OUTPUTS },
}
