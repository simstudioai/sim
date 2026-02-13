import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreateWhiteboardParams {
  accessToken: string
  domain: string
  spaceId: string
  title: string
  parentId?: string
  cloudId?: string
}

export interface ConfluenceCreateWhiteboardResponse {
  success: boolean
  output: {
    ts: string
    id: string
    title: string
    spaceId: string
    parentId: string | null
    parentType: string | null
    authorId: string | null
    createdAt: string | null
  }
}

export const confluenceCreateWhiteboardTool: ToolConfig<
  ConfluenceCreateWhiteboardParams,
  ConfluenceCreateWhiteboardResponse
> = {
  id: 'confluence_create_whiteboard',
  name: 'Confluence Create Whiteboard',
  description: 'Create a new whiteboard in a Confluence space.',
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
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the space to create the whiteboard in',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title for the whiteboard',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the parent content (optional)',
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
    url: () => '/api/tools/confluence/whiteboards',
    method: 'POST',
    headers: (params: ConfluenceCreateWhiteboardParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceCreateWhiteboardParams) => ({
      action: 'create',
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
      title: params.title,
      parentId: params.parentId?.trim(),
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        id: data.id ?? '',
        title: data.title ?? '',
        spaceId: data.spaceId ?? '',
        parentId: data.parentId ?? null,
        parentType: data.parentType ?? null,
        authorId: data.authorId ?? null,
        createdAt: data.createdAt ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    id: { type: 'string', description: 'ID of the created whiteboard' },
    title: { type: 'string', description: 'Title of the whiteboard' },
    spaceId: { type: 'string', description: 'ID of the space' },
    parentId: { type: 'string', description: 'ID of the parent content', optional: true },
    parentType: { type: 'string', description: 'Type of the parent content', optional: true },
    authorId: { type: 'string', description: 'Author account ID', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  },
}
