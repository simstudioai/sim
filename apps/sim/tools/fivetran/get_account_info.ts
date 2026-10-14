import { toStringOrNull } from '@sim/utils/coerce'
import type { FivetranAuthParams, FivetranGetAccountInfoResponse } from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranUrl,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetAccountInfoTool: ToolConfig<
  FivetranAuthParams,
  FivetranGetAccountInfoResponse
> = {
  id: 'fivetran_get_account_info',
  name: 'Fivetran Get Account Info',
  description: 'Get the Fivetran account and the user or system key that the API key belongs to.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: { ...FIVETRAN_AUTH_PARAMS },

  request: {
    url: () => fivetranUrl('/account/info'),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = envelopeData(await response.json())
    return {
      success: true,
      output: {
        accountId: toStringOrNull(data.account_id),
        accountName: toStringOrNull(data.account_name),
        userId: toStringOrNull(data.user_id),
        systemKeyId: toStringOrNull(data.system_key_id),
      },
    }
  },

  outputs: {
    accountId: { type: 'string', description: 'Fivetran account ID', nullable: true },
    accountName: { type: 'string', description: 'Account name', nullable: true },
    userId: {
      type: 'string',
      description: 'User ID, returned when a user API key is used',
      nullable: true,
    },
    systemKeyId: {
      type: 'string',
      description: 'System key ID, returned when a system key is used',
      nullable: true,
    },
  },
}
