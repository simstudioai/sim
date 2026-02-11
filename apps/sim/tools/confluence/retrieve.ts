import type { ConfluenceRetrieveParams, ConfluenceRetrieveResponse } from '@/tools/confluence/types'
import {
  BODY_FORMAT_PROPERTIES,
  TIMESTAMP_OUTPUT,
  VERSION_OUTPUT_PROPERTIES,
} from '@/tools/confluence/types'
import { transformPageData } from '@/tools/confluence/utils'
import type { ToolConfig } from '@/tools/types'

export const confluenceRetrieveTool: ToolConfig<
  ConfluenceRetrieveParams,
  ConfluenceRetrieveResponse
> = {
  id: 'confluence_retrieve',
  name: 'Confluence Retrieve',
  description: 'Retrieve content from Confluence pages using the Confluence API.',
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
      description: 'Confluence page ID to retrieve (numeric ID from page URL or API)',
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
    url: (params: ConfluenceRetrieveParams) => {
      return '/api/tools/confluence/page'
    },
    method: 'POST',
    headers: (params: ConfluenceRetrieveParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceRetrieveParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        cloudId: params.cloudId,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return transformPageData(data)
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    pageId: { type: 'string', description: 'Confluence page ID' },
    title: { type: 'string', description: 'Page title' },
    content: { type: 'string', description: 'Page content with HTML tags stripped' },
    status: {
      type: 'string',
      description: 'Page status (current, archived, trashed, draft)',
      optional: true,
    },
    spaceId: { type: 'string', description: 'ID of the space containing the page', optional: true },
    parentId: { type: 'string', description: 'ID of the parent page', optional: true },
    authorId: { type: 'string', description: 'Account ID of the page author', optional: true },
    createdAt: {
      type: 'string',
      description: 'ISO 8601 timestamp when the page was created',
      optional: true,
    },
    url: { type: 'string', description: 'URL to view the page in Confluence', optional: true },
    body: {
      type: 'object',
      description: 'Raw page body content in storage format',
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
    version: {
      type: 'object',
      description: 'Page version information',
      properties: VERSION_OUTPUT_PROPERTIES,
      optional: true,
    },
  },
}
