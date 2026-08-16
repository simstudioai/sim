import type {
  CloudflareListAccessIdentityProvidersParams,
  CloudflareListAccessIdentityProvidersResponse,
  CloudflareRawAccessIdentityProvider,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listAccessIdentityProvidersTool: ToolConfig<
  CloudflareListAccessIdentityProvidersParams,
  CloudflareListAccessIdentityProvidersResponse
> = {
  id: 'cloudflare_list_access_identity_providers',
  name: 'Cloudflare List Access Identity Providers',
  description:
    'Lists the identity providers configured for Cloudflare Access (Zero Trust) in an account, such as Okta, Entra ID, Google Workspace, or a one-time PIN. Use the returned IDs to restrict an application with allowed_idps. Requires an API token with Account Access: Organizations, Identity Providers, and Groups Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Identity providers are account-scoped',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/identity_providers`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawAccessIdentityProvider[]>(response)

    if (!data.success) {
      return {
        success: false,
        output: { identity_providers: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list Access identity providers'),
      }
    }

    const providers = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        identity_providers: providers.map((provider) => ({
          id: provider.id ?? '',
          name: provider.name ?? null,
          type: provider.type ?? null,
          read_only: provider.read_only ?? null,
          config: provider.config ?? null,
          scim_config: provider.scim_config ?? null,
        })),
        total_count: data.result_info?.total_count ?? providers.length,
      },
    }
  },

  outputs: {
    identity_providers: {
      type: 'array',
      description: 'Identity providers configured for Access',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Identity provider identifier' },
          name: {
            type: 'string',
            description: 'Display name shown to users on the login page',
            optional: true,
          },
          type: {
            type: 'string',
            description: 'Provider type, e.g. azureAD, okta, google, saml, oidc, or onetimepin',
            optional: true,
          },
          read_only: {
            type: 'boolean',
            description: 'Whether the provider is immutable through the API',
            optional: true,
          },
          config: {
            type: 'json',
            description: 'Provider-specific configuration parameters',
            optional: true,
          },
          scim_config: {
            type: 'json',
            description: 'SCIM user and group provisioning configuration',
            optional: true,
          },
        },
      },
    },
    total_count: { type: 'number', description: 'Total number of identity providers' },
  },
}
