import { CONTENT_BODY_OUTPUT_PROPERTIES, VERSION_OUTPUT_PROPERTIES } from '@/tools/confluence/types'
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
    status: string | null
    spaceId: string | null
    parentId: string | null
    body: Record<string, any> | null
    version: Record<string, any> | null
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
        pageId: data.id ?? '',
        title: data.title ?? '',
        status: data.status ?? null,
        spaceId: data.spaceId ?? null,
        parentId: data.parentId ?? null,
        body: data.body ?? null,
        version: data.version ?? null,
        url: data.url || data._links?.webui || '',
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of creation' },
    pageId: { type: 'string', description: 'Created page ID' },
    title: { type: 'string', description: 'Page title' },
    status: { type: 'string', description: 'Page status', optional: true },
    spaceId: { type: 'string', description: 'Space ID', optional: true },
    parentId: { type: 'string', description: 'Parent page ID', optional: true },
    body: {
      type: 'object',
      description: 'Page body content',
      properties: CONTENT_BODY_OUTPUT_PROPERTIES,
      optional: true,
    },
    version: {
      type: 'object',
      description: 'Page version information',
      properties: VERSION_OUTPUT_PROPERTIES,
      optional: true,
    },
    url: { type: 'string', description: 'Page URL' },
  },
}
