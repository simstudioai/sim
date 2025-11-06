import type { ToolConfig } from '@/tools/types'

export interface ConfluenceAddLabelParams {
  accessToken: string
  domain: string
  pageId: string
  labelName: string
  cloudId?: string
}

export interface ConfluenceAddLabelResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    labelName: string
    added: boolean
  }
}

export const confluenceAddLabelTool: ToolConfig<
  ConfluenceAddLabelParams,
  ConfluenceAddLabelResponse
> = {
  id: 'confluence_add_label',
  name: 'Confluence Add Label',
  description: 'Add a label to a Confluence page.',
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
      description: 'Confluence page ID to add label to',
    },
    labelName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Label name to add',
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
    url: () => '/api/tools/confluence/labels',
    method: 'POST',
    headers: (params: ConfluenceAddLabelParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceAddLabelParams) => {
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
        added: true,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of operation' },
    pageId: { type: 'string', description: 'Page ID' },
    labelName: { type: 'string', description: 'Label name' },
    added: { type: 'boolean', description: 'Addition status' },
  },
}
