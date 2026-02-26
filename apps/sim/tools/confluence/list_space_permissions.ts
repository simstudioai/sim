import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListSpacePermissionsParams {
  accessToken: string
  domain: string
  spaceId: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListSpacePermissionsResponse {
  success: boolean
  output: {
    ts: string
    permissions: Array<{
      id: string
      principalType: string | null
      principalId: string | null
      operationKey: string | null
      operationTargetType: string | null
      anonymousAccess: boolean
      unlicensedAccess: boolean
    }>
    spaceId: string
    nextCursor: string | null
  }
}

export const confluenceListSpacePermissionsTool: ToolConfig<
  ConfluenceListSpacePermissionsParams,
  ConfluenceListSpacePermissionsResponse
> = {
  id: 'confluence_list_space_permissions',
  name: 'Confluence List Space Permissions',
  description: 'List permissions for a Confluence space.',
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
      description: 'Space ID to list permissions for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of permissions to return (default: 50, max: 250)',
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
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: () => '/api/tools/confluence/space-permissions',
    method: 'POST',
    headers: (params: ConfluenceListSpacePermissionsParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceListSpacePermissionsParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      spaceId: params.spaceId,
      limit: params.limit,
      cursor: params.cursor,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        permissions: data.permissions || [],
        spaceId: data.spaceId ?? '',
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    permissions: {
      type: 'array',
      description: 'Array of space permissions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Permission ID' },
          principalType: {
            type: 'string',
            description: 'Principal type (user, group, role)',
            optional: true,
          },
          principalId: { type: 'string', description: 'Principal ID', optional: true },
          operationKey: {
            type: 'string',
            description: 'Operation key (read, create, delete, etc.)',
            optional: true,
          },
          operationTargetType: {
            type: 'string',
            description: 'Target type (page, blogpost, space, etc.)',
            optional: true,
          },
          anonymousAccess: { type: 'boolean', description: 'Whether anonymous access is allowed' },
          unlicensedAccess: {
            type: 'boolean',
            description: 'Whether unlicensed access is allowed',
          },
        },
      },
    },
    spaceId: { type: 'string', description: 'Space ID' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
