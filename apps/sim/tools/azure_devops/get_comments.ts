import type {
  AzureDevOpsComment,
  GetCommentsParams,
  GetCommentsResponse,
} from '@/tools/azure_devops/types'
import type { AzureDevOpsRawComment } from '@/tools/azure_devops/utils'
import { formatComment, mapComment } from '@/tools/azure_devops/utils'
import type { ToolConfig } from '@/tools/types'

export const getCommentsTool: ToolConfig<GetCommentsParams, GetCommentsResponse> = {
  id: 'azure_devops_get_comments',
  name: 'Azure DevOps Get Comments',
  description: 'List comments for an Azure DevOps work item.',
  version: '1.0.0',

  params: {
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Azure DevOps organization name',
    },
    project: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Azure DevOps project name',
    },
    workItemId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the work item whose comments should be listed',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of comments to return',
    },
    continuationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuation token for paginating comments',
    },
    includeDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether deleted comments should be returned',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Additional comment data to include: none, reactions, renderedText, renderedTextOnly, all',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order for comments: asc or desc',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Work Items: Read)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/wit/workitems/${Number(params.workItemId)}/comments`
      )
      url.searchParams.set('api-version', '7.2-preview.4')
      if (params.top) url.searchParams.set('$top', Number(params.top).toString())
      if (params.continuationToken)
        url.searchParams.set('continuationToken', params.continuationToken)
      if (params.includeDeleted !== undefined)
        url.searchParams.set('includeDeleted', String(params.includeDeleted))
      if (params.expand) url.searchParams.set('$expand', params.expand)
      if (params.order) url.searchParams.set('order', params.order)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const comments: AzureDevOpsComment[] = (data.comments ?? []).map((raw: AzureDevOpsRawComment) =>
      mapComment(raw)
    )

    const content =
      comments.length === 0
        ? 'No comments found for this work item.'
        : `Found ${data.count ?? comments.length} comment(s):\n\n${comments
            .map(formatComment)
            .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          count: data.count ?? comments.length,
          totalCount: data.totalCount ?? comments.length,
          comments,
          continuationToken: data.continuationToken,
          nextPage: data.nextPage,
          url: data.url,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable summary of work item comments',
    },
    metadata: {
      type: 'object',
      description: 'Comments metadata',
      properties: {
        count: { type: 'number', description: 'Number of comments returned in this page' },
        totalCount: { type: 'number', description: 'Total number of comments on the work item' },
        continuationToken: {
          type: 'string',
          description: 'Continuation token for the next page',
          optional: true,
        },
        nextPage: {
          type: 'string',
          description: 'API URL for the next page',
          optional: true,
        },
        url: {
          type: 'string',
          description: 'API URL for this comments list',
          optional: true,
        },
        comments: {
          type: 'array',
          description: 'Array of work item comments',
          items: {
            type: 'object',
            properties: {
              workItemId: { type: 'number', description: 'Work item ID' },
              commentId: { type: 'number', description: 'Comment ID' },
              version: { type: 'number', description: 'Comment version' },
              text: { type: 'string', description: 'Comment text' },
              renderedText: {
                type: 'string',
                description: 'Rendered HTML comment text when available',
                optional: true,
              },
              createdBy: {
                type: 'string',
                description: 'Display name of the comment author',
                nullable: true,
              },
              createdDate: { type: 'string', description: 'ISO 8601 creation timestamp' },
              modifiedBy: {
                type: 'string',
                description: 'Display name of the last modifier',
                nullable: true,
              },
              modifiedDate: { type: 'string', description: 'ISO 8601 modified timestamp' },
              isDeleted: { type: 'boolean', description: 'Whether the comment is deleted' },
              url: { type: 'string', description: 'API URL for the comment' },
            },
          },
        },
      },
    },
  },
}
