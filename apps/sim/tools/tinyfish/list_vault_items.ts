import type {
  TinyFishListVaultItemsParams,
  TinyFishListVaultItemsResponse,
} from '@/tools/tinyfish/types'
import {
  TINYFISH_AGENT_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Lists the credentials a connected password manager exposes to TinyFish.
 *
 * The response is display-safe metadata only — it carries the credential URIs an
 * automation run scopes itself to, never the secret values behind them.
 */
export const listVaultItemsTool: ToolConfig<
  TinyFishListVaultItemsParams,
  TinyFishListVaultItemsResponse
> = {
  id: 'tinyfish_list_vault_items',
  name: 'TinyFish List Vault Items',
  description:
    'List the credentials available from password managers connected to TinyFish, with the URIs an agent run can be scoped to',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TinyFish API key',
    },
  },

  request: {
    url: `${TINYFISH_AGENT_API_BASE}/v1/vault/items`,
    method: 'GET',
    headers: (params) => tinyfishHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        items: Array.isArray(data.items)
          ? data.items.map((item: any) => ({
              itemId: item?.itemId ?? '',
              connectionId: item?.connectionId ?? null,
              label: item?.label ?? '',
              vaultName: item?.vaultName ?? '',
              domains: item?.domains ?? [],
              fieldMetadata: Array.isArray(item?.fieldMetadata)
                ? item.fieldMetadata.map((field: any) => ({
                    fieldId: field?.fieldId ?? '',
                    label: field?.label ?? '',
                    type: field?.type ?? 'STRING',
                  }))
                : [],
              hasTotp: item?.hasTotp ?? false,
            }))
          : [],
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Credentials available to automation runs',
      items: {
        type: 'object',
        properties: {
          itemId: {
            type: 'string',
            description: 'Credential URI, used as a Vault Credential URI on a run',
          },
          connectionId: {
            type: 'string',
            description: 'Identifier of the vault connection it came from',
            optional: true,
          },
          label: { type: 'string', description: 'Credential name, such as "Amazon Login"' },
          vaultName: { type: 'string', description: 'Vault the credential lives in' },
          domains: {
            type: 'array',
            description: 'Domains the credential applies to',
            items: { type: 'string', description: 'Domain' },
          },
          fieldMetadata: {
            type: 'array',
            description: 'Fields the credential carries, without their values',
            items: {
              type: 'object',
              properties: {
                fieldId: { type: 'string', description: 'Field identifier' },
                label: { type: 'string', description: 'Field name' },
                type: { type: 'string', description: 'STRING, CONCEALED, or OTP' },
              },
            },
          },
          hasTotp: { type: 'boolean', description: 'Whether the credential carries a TOTP secret' },
        },
      },
    },
  },
}
