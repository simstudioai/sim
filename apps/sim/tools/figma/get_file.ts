import type { FigmaGetFileParams, FigmaGetFileResponse } from '@/tools/figma/types'
import type { ToolConfig } from '@/tools/types'

export const figmaGetFileTool: ToolConfig<FigmaGetFileParams, FigmaGetFileResponse> = {
  id: 'figma_get_file',
  name: 'Figma - Get File',
  description:
    'Get the full document structure of a Figma file including all nodes, components, and styles',
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
    depth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Depth of the document tree to return (optional)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.figma.com/v1/files/${params.fileKey}`
      const queryParams = new URLSearchParams()

      if (params.depth) {
        queryParams.append('depth', params.depth.toString())
      }

      const query = queryParams.toString()
      return query ? `${baseUrl}?${query}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        name: data.name,
        lastModified: data.lastModified,
        thumbnailUrl: data.thumbnailUrl,
        version: data.version,
        document: data.document,
        components: data.components || {},
        styles: data.styles || {},
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Name of the Figma file',
    },
    lastModified: {
      type: 'string',
      description: 'Timestamp when the file was last modified',
    },
    thumbnailUrl: {
      type: 'string',
      description: 'URL to the file thumbnail',
    },
    version: {
      type: 'string',
      description: 'Current version of the file',
    },
    document: {
      type: 'json',
      description: 'Full document tree structure',
    },
    components: {
      type: 'json',
      description: 'Components defined in the file',
    },
    styles: {
      type: 'json',
      description: 'Styles defined in the file',
    },
  },
}
