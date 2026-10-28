import { toStringOrNull } from '@sim/utils/coerce'
import { filterUndefined, toRecord } from '@sim/utils/object'
import type {
  FivetranCreateConnectCardParams,
  FivetranCreateConnectCardResponse,
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

export const fivetranCreateConnectCardTool: ToolConfig<
  FivetranCreateConnectCardParams,
  FivetranCreateConnectCardResponse
> = {
  id: 'fivetran_create_connect_card',
  name: 'Fivetran Create Connect Card',
  description:
    'Generate a Connect Card link that lets someone authorize and finish setting up a Fivetran connection in a Fivetran-hosted form.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
    redirectUri: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'HTTPS URL to send the user to after they finish setup',
    },
    hideSetupGuide: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hide the embedded setup guide',
    },
    allFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show fields that are hidden by default',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/connect-card`),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => ({
      connect_card_config: filterUndefined({
        redirect_uri: params.redirectUri?.trim(),
        hide_setup_guide: optionalBoolean(params.hideSetupGuide),
        all_fields: optionalBoolean(params.allFields),
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = envelopeData(await response.json())
    const card = toRecord(data.connect_card)
    const config = toRecord(data.connect_card_config)
    return {
      success: true,
      output: {
        connectionId: toStringOrNull(data.connector_id),
        uri: toStringOrNull(card.uri),
        token: toStringOrNull(card.token),
        redirectUri: toStringOrNull(config.redirect_uri),
      },
    }
  },

  outputs: {
    connectionId: { type: 'string', description: 'Connection ID', nullable: true },
    uri: {
      type: 'string',
      description: 'Connect Card URL to send the user to; it embeds a short-lived token',
      nullable: true,
    },
    token: { type: 'string', description: 'Short-lived Connect Card token', nullable: true },
    redirectUri: {
      type: 'string',
      description: 'Where the user is sent after setup',
      nullable: true,
    },
  },
}
