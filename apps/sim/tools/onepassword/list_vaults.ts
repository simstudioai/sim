import type {
  OnePasswordListVaultsParams,
  OnePasswordListVaultsResponse,
} from '@/tools/onepassword/types'
import type { ToolConfig } from '@/tools/types'

export const listVaultsTool: ToolConfig<
  OnePasswordListVaultsParams,
  OnePasswordListVaultsResponse
> = {
  id: 'onepassword_list_vaults',
  name: '1Password List Vaults',
  description: 'List all vaults accessible by the Connect token',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: '1Password Connect API token',
    },
    serverUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: '1Password Connect server URL (e.g., http://localhost:8080)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SCIM filter expression (e.g., name eq "My Vault")',
    },
  },

  request: {
    url: (params) => {
      const base = params.serverUrl.replace(/\/$/, '')
      const query = params.filter ? `?filter=${encodeURIComponent(params.filter)}` : ''
      return `${base}/v1/vaults${query}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        vaults: (data ?? []).map((vault: any) => ({
          id: vault.id ?? null,
          name: vault.name ?? null,
          description: vault.description ?? null,
          attributeVersion: vault.attributeVersion ?? 0,
          contentVersion: vault.contentVersion ?? 0,
          items: vault.items ?? 0,
          type: vault.type ?? null,
          createdAt: vault.createdAt ?? null,
          updatedAt: vault.updatedAt ?? null,
        })),
      },
    }
  },

  outputs: {
    vaults: {
      type: 'array',
      description: 'List of accessible vaults',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Vault ID' },
          name: { type: 'string', description: 'Vault name' },
          description: { type: 'string', description: 'Vault description', optional: true },
          attributeVersion: { type: 'number', description: 'Vault attribute version' },
          contentVersion: { type: 'number', description: 'Vault content version' },
          items: { type: 'number', description: 'Number of items in the vault' },
          type: {
            type: 'string',
            description: 'Vault type (USER_CREATED, PERSONAL, EVERYONE, TRANSFER)',
          },
          createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
          updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
        },
      },
    },
  },
}
