import { toStringOrNull } from '@sim/utils/coerce'
import { filterUndefined, toRecord } from '@sim/utils/object'
import type {
  FivetranSyncConnectionParams,
  FivetranSyncConnectionResponse,
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
  optionalBoolean,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranSyncConnectionTool: ToolConfig<
  FivetranSyncConnectionParams,
  FivetranSyncConnectionResponse
> = {
  id: 'fivetran_sync_connection',
  name: 'Fivetran Sync Connection',
  description:
    'Start an incremental sync of a Fivetran connection now, without changing its schedule.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stop a sync that is already running and start again. By default a running sync is left alone.',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/sync`),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => filterUndefined({ force: optionalBoolean(params.force) }),
  },

  transformResponse: async (response: Response) => {
    const body = await response.json()
    return {
      success: true,
      output: {
        result: toStringOrNull(envelopeData(body).result),
        message: toStringOrNull(toRecord(body).message),
      },
    }
  },

  outputs: {
    result: {
      type: 'string',
      description: 'Sync start result (STARTED, PAUSED, INCOMPLETE, ALREADY_RUNNING, NOT_STARTED)',
      nullable: true,
    },
    message: { type: 'string', description: 'Fivetran response message', nullable: true },
  },
}
