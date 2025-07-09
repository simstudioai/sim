import type { ToolConfig } from '../types'

export const docsSearchTool: ToolConfig = {
  id: 'docs_search_internal',
  name: 'Search Documentation',
  description:
    'Search Sim Studio documentation for information about features, tools, workflows, and functionality',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      description: 'The search query to find relevant documentation',
    },
    topK: {
      type: 'number',
      required: false,
      description: 'Number of results to return (default: 5, max: 10)',
    },
  },

  request: {
    url: '/api/docs/search',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      query: params.query,
      topK: params.topK || 5,
    }),
    isInternalRoute: true,
  },
} 