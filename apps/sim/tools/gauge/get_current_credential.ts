import {
  API_KEY_INFO_PROPERTIES,
  TOKEN_INFO_PROPERTIES,
  USER_INFO_PROPERTIES,
} from '@/tools/gauge/outputs'
import type {
  GaugeGetCurrentCredentialParams,
  GaugeGetCurrentCredentialResponse,
  GaugeMe,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'

export const gaugeGetCurrentCredentialTool: ToolConfig<
  GaugeGetCurrentCredentialParams,
  GaugeGetCurrentCredentialResponse
> = {
  id: 'gauge_get_current_credential',
  name: 'Gauge Get Current Credential',
  description: 'Read the identity, permissions, and expiry of the connected Gauge API key.',
  version: '1.0.0',
  oauth: gaugeOAuth,
  params: {
    ...gaugeAuthParams,
  },
  request: {
    url: () => buildGaugeUrl(`/me`),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeMe
    return {
      success: true,
      output: {
        user:
          data.user == null
            ? null
            : { id: data.user.id, email: data.user.email, name: data.user.name },
        apiKey:
          data.apiKey == null
            ? null
            : {
                id: data.apiKey.id,
                name: data.apiKey.name,
                prefix: data.apiKey.prefix,
                organization: {
                  id: data.apiKey.organization.id,
                  slug: data.apiKey.organization.slug,
                  name: data.apiKey.organization.name,
                },
              },
        token: {
          kind: data.token.kind,
          scopes: data.token.scopes ?? [],
          expiresAt: data.token.expiresAt ?? null,
        },
      },
    }
  },
  outputs: {
    user: { type: 'json', properties: USER_INFO_PROPERTIES, description: 'User', nullable: true },
    apiKey: {
      type: 'json',
      properties: API_KEY_INFO_PROPERTIES,
      description: 'Api key',
      nullable: true,
    },
    token: { type: 'json', properties: TOKEN_INFO_PROPERTIES, description: 'Token' },
  },
}
