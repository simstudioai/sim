import type { FigmaGetNodesParams, FigmaGetNodesResponse } from '@/tools/figma/types'
import type { ToolConfig } from '@/tools/types'

export const figmaGetNodesTool: ToolConfig<FigmaGetNodesParams, FigmaGetNodesResponse> = {
  id: 'figma_get_nodes',
  name: 'Figma - Get Nodes',
  description: 'Get specific nodes from a Figma file by their IDs',
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
    nodeIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of node IDs to retrieve',
    },
    depth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Depth of the node subtree to return (optional)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.figma.com/v1/files/${params.fileKey}/nodes`
      const queryParams = new URLSearchParams()

      queryParams.append('ids', params.nodeIds)

      if (params.depth) {
        queryParams.append('depth', params.depth.toString())
      }

      return `${baseUrl}?${queryParams.toString()}`
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
        nodes: data.nodes || {},
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
    nodes: {
      type: 'json',
      description: 'Map of node IDs to their document subtrees',
    },
  },
}
