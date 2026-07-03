import type {
  OnePasswordGetItemFileParams,
  OnePasswordGetItemFileResponse,
} from '@/tools/onepassword/types'
import type { ToolConfig } from '@/tools/types'

export const getItemFileTool: ToolConfig<
  OnePasswordGetItemFileParams,
  OnePasswordGetItemFileResponse
> = {
  id: 'onepassword_get_item_file',
  name: '1Password Get Item File',
  description: 'Download the content of a file attached to an item',
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
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The item UUID the file is attached to',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The file ID (from the item\'s "files" array, e.g. via Get Item)',
    },
  },

  request: {
    url: '/api/tools/onepassword/get-item-file',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      connectionMode: params.connectionMode,
      serviceAccountToken: params.serviceAccountToken,
      serverUrl: params.serverUrl,
      apiKey: params.apiKey,
      vaultId: params.vaultId,
      itemId: params.itemId,
      fileId: params.fileId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.error) {
      return {
        success: false,
        output: { file: { name: '', mimeType: '', data: '', size: 0 } },
        error: data.error,
      }
    }
    return {
      success: true,
      output: {
        file: {
          name: data.file.name,
          mimeType: data.file.mimeType,
          data: data.file.data,
          size: data.file.size,
        },
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded file attachment',
    },
  },
}
