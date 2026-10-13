import {
  type FivetranConnectionParams,
  type FivetranMessageResponse,
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
  transformMessageResponse,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranDeleteConnectionTool: ToolConfig<
  FivetranConnectionParams,
  FivetranMessageResponse
> = {
  id: 'fivetran_delete_connection',
  name: 'Fivetran Delete Connection',
  description: 'Delete a Fivetran connection. This cannot be undone.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
  },

  request: {
    url: (params) => fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}`),
    method: 'DELETE',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: transformMessageResponse,

  outputs: { ...MESSAGE_OUTPUTS },
}
