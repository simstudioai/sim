import type { ConfluenceUpdateParams, ConfluenceUpdateResponse } from '@/tools/confluence/types'
import { CONTENT_BODY_OUTPUT_PROPERTIES, VERSION_OUTPUT_PROPERTIES } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export const confluenceUpdateTool: ToolConfig<ConfluenceUpdateParams, ConfluenceUpdateResponse> = {
  id: 'confluence_update',
  name: 'Confluence Update',
  description: 'Update a Confluence page using the Confluence API.',
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
      description: 'Confluence page ID to update (numeric ID from page URL or API)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the page',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New content for the page in Confluence storage format',
    },
    version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version number of the page (required for preventing conflicts)',
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
    url: (params: ConfluenceUpdateParams) => {
      return '/api/tools/confluence/page'
    },
    method: 'PUT',
    headers: (params: ConfluenceUpdateParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceUpdateParams) => {
      const body: Record<string, any> = {
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        cloudId: params.cloudId,
        title: params.title,
        body: params.content
          ? {
              representation: 'storage',
              value: params.content,
            }
          : undefined,
        version: {
          number: params.version || 1,
          message: params.version ? 'Updated via Sim' : 'Initial update via Sim',
        },
      }
      return body
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
        body: data.body ?? null,
        version: data.version ?? null,
        url: data._links?.webui ?? null,
        success: true,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of update' },
    pageId: { type: 'string', description: 'Confluence page ID' },
    title: { type: 'string', description: 'Updated page title' },
    status: { type: 'string', description: 'Page status', optional: true },
    spaceId: { type: 'string', description: 'Space ID', optional: true },
    body: {
      type: 'object',
      description: 'Page body content in storage format',
      properties: CONTENT_BODY_OUTPUT_PROPERTIES,
      optional: true,
    },
    version: {
      type: 'object',
      description: 'Page version information',
      properties: VERSION_OUTPUT_PROPERTIES,
      optional: true,
    },
    url: { type: 'string', description: 'URL to view the page in Confluence', optional: true },
    success: { type: 'boolean', description: 'Update operation success status' },
  },
}
