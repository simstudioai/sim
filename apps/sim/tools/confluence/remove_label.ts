import type { ToolConfig } from '@/tools/types'

export interface ConfluenceRemoveLabelParams {
  accessToken: string
  domain: string
  pageId: string
  labelName: string
  cloudId?: string
}

export interface ConfluenceRemoveLabelResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    labelName: string
    removed: boolean
  }
}

export const confluenceRemoveLabelTool: ToolConfig<
  ConfluenceRemoveLabelParams,
  ConfluenceRemoveLabelResponse
> = {
  id: 'confluence_remove_label',
  name: 'Confluence Remove Label',
  description: 'Remove a label from a Confluence page.',
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
      description: 'Confluence page ID to remove label from',
    },
    labelName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Label name to remove',
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
    url: () => '/api/tools/confluence/label',
    method: 'DELETE',
    headers: (params: ConfluenceRemoveLabelParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceRemoveLabelParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        pageId: params.pageId,
        labelName: params.labelName,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.pageId || '',
        labelName: data.labelName || '',
        removed: true,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of operation' },
    pageId: { type: 'string', description: 'Page ID' },
    labelName: { type: 'string', description: 'Label name' },
    removed: { type: 'boolean', description: 'Removal status' },
  },
}
