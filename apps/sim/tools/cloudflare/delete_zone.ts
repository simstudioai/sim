import type {
  CloudflareDeleteZoneParams,
  CloudflareDeleteZoneResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const deleteZoneTool: ToolConfig<CloudflareDeleteZoneParams, CloudflareDeleteZoneResponse> =
  {
    id: 'cloudflare_delete_zone',
    name: 'Cloudflare Delete Zone',
    description: 'Deletes a zone (domain) from the Cloudflare account.',
    version: '1.0.0',

    params: {
      zoneId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The zone ID to delete',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Cloudflare API Token',
      },
    },

    request: {
      url: (params) => `https://api.cloudflare.com/client/v4/zones/${params.zoneId}`,
      method: 'DELETE',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        return {
          success: false,
          output: { id: '' },
          error: data.errors?.[0]?.message ?? 'Failed to delete zone',
        }
      }

      return {
        success: true,
        output: {
          id: data.result?.id ?? '',
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Deleted zone ID' },
    },
  }
