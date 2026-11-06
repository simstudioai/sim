import { filterUndefined } from '@sim/utils/object'
import {
  type FivetranSchemaConfigResponse,
  type FivetranUpdateConnectionTableParams,
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
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranUpdateConnectionTableTool: ToolConfig<
  FivetranUpdateConnectionTableParams,
  FivetranSchemaConfigResponse
> = {
  id: 'fivetran_update_connection_table',
  name: 'Fivetran Update Connection Table',
  description:
    'Enable or disable syncing of one table in a Fivetran connection, and optionally change its sync mode.',
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
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name as stored in the connection schema config (case-sensitive)',
    },
    enabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the table syncs to the destination',
    },
    syncMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sync mode: SOFT_DELETE, HISTORY, or LIVE (only for connectors that support switching)',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(
        `/connections/${fivetranId(params.connectionId, 'connectionId')}/schemas/${fivetranId(params.schemaName, 'schemaName')}/tables/${fivetranId(params.tableName, 'tableName')}`
      ),
    method: 'PATCH',
    headers: (params) => fivetranHeaders(params),
    body: (params) => {
      const enabled = optionalBoolean(params.enabled)
      if (enabled === undefined) throw new Error('Specify whether the table is enabled.')
      return filterUndefined({ enabled, sync_mode: trimmed(params.syncMode) })
    },
  },

  transformResponse: async (response: Response) => {
    return { success: true, output: mapSchemaConfig(envelopeData(await response.json())) }
  },

  outputs: { ...SCHEMA_CONFIG_OUTPUTS },
}
