import type {
  OnePasswordGetVaultParams,
  OnePasswordGetVaultResponse,
} from '@/tools/onepassword/types'
import type { ToolConfig } from '@/tools/types'

export const getVaultTool: ToolConfig<OnePasswordGetVaultParams, OnePasswordGetVaultResponse> = {
  id: 'onepassword_get_vault',
  name: '1Password Get Vault',
  description: 'Get details of a specific vault by ID',
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
    vaultId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The vault UUID',
    },
  },

  request: {
    url: (params) => {
      const base = params.serverUrl.replace(/\/$/, '')
      return `${base}/v1/vaults/${params.vaultId}`
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
        id: data.id ?? null,
        name: data.name ?? null,
        description: data.description ?? null,
        attributeVersion: data.attributeVersion ?? 0,
        contentVersion: data.contentVersion ?? 0,
        items: data.items ?? 0,
        type: data.type ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
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
}
