import type {
  LogfireGetTokenInfoParams,
  LogfireGetTokenInfoResponse,
  LogfireReadTokenInfo,
} from '@/tools/logfire/types'
import {
  LOGFIRE_READ_TOKEN_INFO_PATH,
  logfireHeaders,
  logfireUrl,
  parseLogfireResponse,
} from '@/tools/logfire/utils'
import type { ToolConfig } from '@/tools/types'

export const logfireGetTokenInfoTool: ToolConfig<
  LogfireGetTokenInfoParams,
  LogfireGetTokenInfoResponse
> = {
  id: 'logfire_get_token_info',
  name: 'Logfire Get Token Info',
  description:
    'Resolve which Logfire organization and project a read token belongs to. Useful for confirming a credential targets the expected project before querying it.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Logfire read token',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Logfire data region: auto, us, or eu. Auto reads the region from the token.',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Base URL of a self-hosted Logfire instance, e.g. https://logfire.example.com. Overrides region. Leave blank for Logfire Cloud.',
    },
  },

  request: {
    url: (params) => logfireUrl(params, LOGFIRE_READ_TOKEN_INFO_PATH),
    method: 'GET',
    headers: (params) => logfireHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const info = await parseLogfireResponse<LogfireReadTokenInfo>(response)

    return {
      success: true,
      output: {
        organizationName: info.organization_name ?? null,
        projectName: info.project_name ?? null,
      },
    }
  },

  outputs: {
    organizationName: {
      type: 'string',
      description: 'Logfire organization the read token belongs to',
      nullable: true,
    },
    projectName: {
      type: 'string',
      description: 'Logfire project the read token belongs to',
      nullable: true,
    },
  },
}
