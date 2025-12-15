import type { FigmaGetStylesParams, FigmaGetStylesResponse } from '@/tools/figma/types'
import type { ToolConfig } from '@/tools/types'

export const figmaGetStylesTool: ToolConfig<FigmaGetStylesParams, FigmaGetStylesResponse> = {
  id: 'figma_get_styles',
  name: 'Figma - Get Styles',
  description: 'Get all published styles (colors, typography, effects, grids) from a Figma file',
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
    url: (params) => `https://api.figma.com/v1/files/${params.fileKey}/styles`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const styles = data.meta?.styles || []

    return {
      success: true,
      output: {
        styles,
        metadata: {
          styleCount: styles.length,
        },
      },
    }
  },

  outputs: {
    styles: {
      type: 'json',
      description: 'Array of styles in the file (colors, typography, effects, grids)',
    },
    metadata: {
      type: 'json',
      description: 'Metadata including style count',
    },
  },
}
