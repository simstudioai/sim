import { filterUndefined } from '@sim/utils/object'
import {
  type FivetranReloadConnectionSchemaParams,
  type FivetranSchemaConfigResponse,
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
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranReloadConnectionSchemaTool: ToolConfig<
  FivetranReloadConnectionSchemaParams,
  FivetranSchemaConfigResponse
> = {
  id: 'fivetran_reload_connection_schema',
  name: 'Fivetran Reload Connection Schema',
  description:
    'Reload the schema config of a Fivetran connection from its source to pick up new schemas, tables, and columns. Large sources can take a long time.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    excludeMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'PRESERVE (default) keeps the enabled state of every schema and table; EXCLUDE sets schemas and tables as disabled when the config is reloaded',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/schemas/reload`),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => filterUndefined({ exclude_mode: trimmed(params.excludeMode) }),
  },

  transformResponse: async (response: Response) => {
    return { success: true, output: mapSchemaConfig(envelopeData(await response.json())) }
  },

  outputs: { ...SCHEMA_CONFIG_OUTPUTS },
}
