import type {
  JsmSearchKnowledgeBaseParams,
  JsmSearchKnowledgeBaseResponse,
} from '@/tools/jsm/types'
import { KNOWLEDGE_BASE_ARTICLE_PROPERTIES } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmSearchKnowledgeBaseTool: ToolConfig<
  JsmSearchKnowledgeBaseParams,
  JsmSearchKnowledgeBaseResponse
> = {
  id: 'jsm_search_knowledge_base',
  name: 'JSM Search Knowledge Base',
  description: 'Search knowledge base articles in Jira Service Management',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira Service Management',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Jira Cloud ID for the instance',
    },
    serviceDeskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Service Desk ID to search within (optional, searches globally if omitted)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query for knowledge base articles',
    },
    highlight: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to highlight matching text in results',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start index for pagination (e.g., 0, 50, 100)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results to return (e.g., 10, 25, 50)',
    },
  },

  request: {
    url: '/api/tools/jsm/knowledgebase',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      serviceDeskId: params.serviceDeskId,
      query: params.query,
      highlight: params.highlight,
      start: params.start,
      limit: params.limit,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          articles: [],
          total: 0,
          isLastPage: true,
        },
        error: 'Empty response from API',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        articles: [],
        total: 0,
        isLastPage: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    articles: {
      type: 'array',
      description: 'List of knowledge base articles',
      items: {
        type: 'object',
        properties: KNOWLEDGE_BASE_ARTICLE_PROPERTIES,
      },
    },
    total: { type: 'number', description: 'Total number of articles found' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
