import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceDeleteLabelParams {
  accessToken: string
  domain: string
  pageId: string
  labelName: string
  cloudId?: string
}

export interface ConfluenceDeleteLabelResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    labelName: string
    deleted: boolean
  }
}

export const confluenceDeleteLabelTool: ToolConfig<
  ConfluenceDeleteLabelParams,
  ConfluenceDeleteLabelResponse
> = {
  id: 'confluence_delete_label',
  name: 'Confluence Delete Label',
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
      description: 'Confluence page ID to remove the label from',
    },
    labelName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the label to remove',
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
    method: 'DELETE',
    headers: (params: ConfluenceDeleteLabelParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceDeleteLabelParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      labelName: params.labelName?.trim(),
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.pageId ?? '',
        labelName: data.labelName ?? '',
        deleted: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: {
      type: 'string',
      description: 'Page ID the label was removed from',
    },
    labelName: {
      type: 'string',
      description: 'Name of the removed label',
    },
    deleted: {
      type: 'boolean',
      description: 'Deletion status',
    },
  },
}
