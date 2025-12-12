import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListLabelsParams {
  accessToken: string
  domain: string
  pageId: string
  cloudId?: string
}

export interface ConfluenceListLabelsResponse {
  success: boolean
  output: {
    ts: string
    labels: Array<{
      id: string
      name: string
      prefix: string
    }>
  }
}

export const confluenceListLabelsTool: ToolConfig<
  ConfluenceListLabelsParams,
  ConfluenceListLabelsResponse
> = {
  id: 'confluence_list_labels',
  name: 'Confluence List Labels',
  description: 'List all labels on a Confluence page.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Confluence page ID to list labels from',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: ConfluenceListLabelsParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
      })
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/labels?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListLabelsParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        labels: data.labels || [],
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of retrieval' },
    labels: { type: 'array', description: 'List of labels' },
  },
}
