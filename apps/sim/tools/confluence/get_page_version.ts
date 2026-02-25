import {
  BODY_FORMAT_PROPERTIES,
  DETAILED_VERSION_OUTPUT_PROPERTIES,
  TIMESTAMP_OUTPUT,
} from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetPageVersionParams {
  accessToken: string
  domain: string
  pageId: string
  versionNumber: number
  cloudId?: string
}

export interface ConfluenceGetPageVersionResponse {
  success: boolean
  output: {
    ts: string
    pageId: string
    title: string | null
    content: string | null
    version: {
      number: number
      message: string | null
      minorEdit: boolean
      authorId: string | null
      createdAt: string | null
      contentTypeModified: boolean | null
      collaborators: string[] | null
      prevVersion: number | null
      nextVersion: number | null
    }
    body: {
      storage?: {
        value: string
        representation: string
      }
    } | null
  }
}

export const confluenceGetPageVersionTool: ToolConfig<
  ConfluenceGetPageVersionParams,
  ConfluenceGetPageVersionResponse
> = {
  id: 'confluence_get_page_version',
  name: 'Confluence Get Page Version',
  description: 'Get details about a specific version of a Confluence page.',
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
      description: 'The ID of the page',
    },
    versionNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The version number to retrieve (e.g., 1, 2, 3)',
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
    url: () => '/api/tools/confluence/page-versions',
    method: 'POST',
    headers: (params: ConfluenceGetPageVersionParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceGetPageVersionParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      pageId: params.pageId?.trim(),
      versionNumber: Number(params.versionNumber),
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
        title: data.title ?? null,
        content: data.content ?? null,
        version: data.version ?? {
          number: 0,
          message: null,
          minorEdit: false,
          authorId: null,
          createdAt: null,
        },
        body: data.body ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: { type: 'string', description: 'ID of the page' },
    title: { type: 'string', description: 'Page title at this version', optional: true },
    content: {
      type: 'string',
      description: 'Page content with HTML tags stripped at this version',
      optional: true,
    },
    version: {
      type: 'object',
      description: 'Detailed version information',
      properties: DETAILED_VERSION_OUTPUT_PROPERTIES,
    },
    body: {
      type: 'object',
      description: 'Raw page body content in storage format at this version',
      properties: {
        storage: {
          type: 'object',
          description: 'Body in storage format (Confluence markup)',
          properties: BODY_FORMAT_PROPERTIES,
          optional: true,
        },
      },
      optional: true,
    },
  },
}
