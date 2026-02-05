import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceAddLabelParams {
  accessToken: string
  domain: string
  pageId: string
  labelName: string
  prefix?: string
  cloudId?: string
}

export interface ConfluenceAddLabelResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    labelName: string
    labelId: string
  }
}

export const confluenceAddLabelTool: ToolConfig<
  ConfluenceAddLabelParams,
  ConfluenceAddLabelResponse
> = {
  id: 'confluence_add_label',
  name: 'Confluence Add Label',
  description: 'Add a label to a Confluence page for organization and categorization.',
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
      description: 'Confluence page ID to add the label to',
    },
    labelName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the label to add',
    },
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label prefix: global (default), my, team, or system',
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
    headers: (params: ConfluenceAddLabelParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceAddLabelParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      labelName: params.labelName?.trim(),
      prefix: params.prefix || 'global',
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
        labelName: data.labelName ?? data.name ?? '',
        labelId: data.id ?? '',
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: {
      type: 'string',
      description: 'Page ID that the label was added to',
    },
    labelName: {
      type: 'string',
      description: 'Name of the added label',
    },
    labelId: {
      type: 'string',
      description: 'ID of the added label',
    },
  },
}
