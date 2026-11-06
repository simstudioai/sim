import { filterUndefined } from '@sim/utils/object'
import {
  type FivetranSchemaConfigResponse,
  type FivetranUpdateSchemaConfigParams,
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
  parseJsonObject,
  trimmed,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranUpdateSchemaConfigTool: ToolConfig<
  FivetranUpdateSchemaConfigParams,
  FivetranSchemaConfigResponse
> = {
  id: 'fivetran_update_schema_config',
  name: 'Fivetran Update Schema Config',
  description:
    'Update how a Fivetran connection handles new schemas, tables, and columns, and enable or disable schemas and tables in one call.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    schemaChangeHandling: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How new source objects are handled: ALLOW_ALL (sync new schemas, tables, and columns), ALLOW_COLUMNS (only new columns), or BLOCK_ALL',
    },
    schemas: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Schemas to change, keyed by schema name, e.g. {"public": {"enabled": true, "tables": {"orders": {"enabled": false}}}}',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/schemas`),
    method: 'PATCH',
    headers: (params) => fivetranHeaders(params),
    body: (params) => {
      const body = filterUndefined({
        schema_change_handling: trimmed(params.schemaChangeHandling),
        schemas: parseJsonObject(params.schemas, 'schemas'),
      })
      if (Object.keys(body).length === 0) {
        throw new Error('Provide schemaChangeHandling, schemas, or both.')
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    return { success: true, output: mapSchemaConfig(envelopeData(await response.json())) }
  },

  outputs: { ...SCHEMA_CONFIG_OUTPUTS },
}
