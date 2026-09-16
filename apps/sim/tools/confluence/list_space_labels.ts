import { LABEL_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { InternalToolConfig } from '@/tools/types'

export interface ConfluenceListSpaceLabelsParams {
  accessToken: string
  domain: string
  spaceId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListSpaceLabelsResponse {
  success: boolean
  output: {
    ts: string
    spaceId: string
    labels: Array<{
      id: string
      name: string
      prefix: string
    }>
    nextCursor: string | null
  }
}

export const confluenceListSpaceLabelsTool: InternalToolConfig<
  ConfluenceListSpaceLabelsParams,
  ConfluenceListSpaceLabelsResponse
> = {
  id: 'confluence_list_space_labels',
  name: 'Confluence List Space Labels',
  description: 'List all labels associated with a Confluence space.',
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
      visibility: 'user-or-llm',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the Confluence space to list labels from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of labels to return (default: 25, max: 250)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  operation: {
    input: (params: ConfluenceListSpaceLabelsParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        spaceId: params.spaceId,
        limit: String(params.limit || 25),
      })
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return Object.fromEntries(query)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        spaceId: data.spaceId ?? '',
        labels: data.labels ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    spaceId: { type: 'string', description: 'ID of the space' },
    labels: {
      type: 'array',
      description: 'Array of labels on the space',
      items: {
        type: 'object',
        properties: LABEL_ITEM_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
