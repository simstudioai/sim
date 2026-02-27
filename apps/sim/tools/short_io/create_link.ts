import type { ShortIoCreateLinkParams } from '@/tools/short_io/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const shortIoCreateLinkTool: ToolConfig<ShortIoCreateLinkParams, ToolResponse> = {
  id: 'short_io_create_link',
  name: 'Short.io Create Link',
  description: 'Create a short link using your Short.io custom domain.',
  version: '1.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Short.io Secret API Key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your registered Short.io custom domain',
    },
    originalURL: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The long URL to shorten',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional custom path for the short link',
    },
  },
  request: {
    url: 'https://api.short.io/links',
    method: 'POST',
    headers: (params) => ({
      Authorization: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const bodyData: Record<string, string> = {
        domain: params.domain,
        originalURL: params.originalURL,
      }
      if (params.path) {
        bodyData.path = params.path
      }
      return bodyData
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      return {
        success: false,
        output: {
          success: false,
          error: `Failed to create short link: ${errorText}`,
        },
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: true,
      output: {
        success: true,
        shortURL: data.shortURL,
        idString: data.idString,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the link was created successfully' },
    shortURL: { type: 'string', description: 'The generated short link URL' },
    idString: { type: 'string', description: 'The unique Short.io link ID string' },
    error: { type: 'string', description: 'Error message if failed' },
  },
}
