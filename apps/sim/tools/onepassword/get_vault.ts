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
    connectionMode: {
      type: 'string',
      required: false,
      description: 'Connection mode: "service_account" or "connect"',
    },
    serviceAccountToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: '1Password Service Account token (for Service Account mode)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: '1Password Connect API token (for Connect Server mode)',
    },
    serverUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: '1Password Connect server URL (for Connect Server mode)',
    },
    vaultId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The vault UUID',
    },
  },

  request: {
    url: '/api/tools/onepassword/get-vault',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      connectionMode: params.connectionMode,
      serviceAccountToken: params.serviceAccountToken,
      serverUrl: params.serverUrl,
      apiKey: params.apiKey,
      vaultId: params.vaultId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.error) {
      return {
        success: false,
        output: {
          id: '',
          name: '',
          description: null,
          attributeVersion: 0,
          contentVersion: 0,
          items: 0,
          type: '',
          createdAt: null,
          updatedAt: null,
        },
        error: data.error,
      }
    }
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
