import type { FigmaGetComponentsParams, FigmaGetComponentsResponse } from '@/tools/figma/types'
import type { ToolConfig } from '@/tools/types'

export const figmaGetComponentsTool: ToolConfig<
  FigmaGetComponentsParams,
  FigmaGetComponentsResponse
> = {
  id: 'figma_get_components',
  name: 'Figma - Get Components',
  description: 'Get all published components from a Figma file',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'figma',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    fileKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The key of the Figma file (from the URL: figma.com/file/{fileKey}/...)',
    },
  },

  request: {
    url: (params) => `https://api.figma.com/v1/files/${params.fileKey}/components`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const components = data.meta?.components || []

    return {
      success: true,
      output: {
        components,
        metadata: {
          componentCount: components.length,
        },
      },
    }
  },

  outputs: {
    components: {
      type: 'json',
      description: 'Array of components in the file',
    },
    metadata: {
      type: 'json',
      description: 'Metadata including component count',
    },
  },
}
