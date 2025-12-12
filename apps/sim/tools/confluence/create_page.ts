import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreatePageParams {
  accessToken: string
  domain: string
  spaceId: string
  title: string
  content: string
  parentId?: string
  cloudId?: string
}

export interface ConfluenceCreatePageResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    title: string
    url: string
  }
}

export const confluenceCreatePageTool: ToolConfig<
  ConfluenceCreatePageParams,
  ConfluenceCreatePageResponse
> = {
  id: 'confluence_create_page',
  name: 'Confluence Create Page',
  description: 'Create a new page in a Confluence space.',
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
      description: 'Confluence space ID where the page will be created',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the new page',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Page content in Confluence storage format (HTML)',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent page ID if creating a child page',
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
    url: () => '/api/tools/confluence/create-page',
    method: 'POST',
    headers: (params: ConfluenceCreatePageParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceCreatePageParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        spaceId: params.spaceId,
        title: params.title,
        content: params.content,
        parentId: params.parentId,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.id,
        title: data.title,
        url: data.url || data._links?.webui || '',
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of creation' },
    pageId: { type: 'string', description: 'Created page ID' },
    title: { type: 'string', description: 'Page title' },
    url: { type: 'string', description: 'Page URL' },
  },
}
