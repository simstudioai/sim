import type {
  AddCommentParams,
  AddCommentResponse,
  AzureDevOpsComment,
} from '@/tools/azure_devops/types'
import type { AzureDevOpsRawComment } from '@/tools/azure_devops/utils'
import { formatComment, mapComment } from '@/tools/azure_devops/utils'
import type { ToolConfig } from '@/tools/types'

export const addCommentTool: ToolConfig<AddCommentParams, AddCommentResponse> = {
  id: 'azure_devops_add_comment',
  name: 'Azure DevOps Add Comment',
  description: 'Add a comment to a work item in Azure DevOps.',
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
      description: 'ID of the work item to comment on',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment text (HTML supported, e.g. "<p>My comment</p>")',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Work Items: Read & Write)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/wit/workitems/${Number(params.workItemId)}/comments`
      )
      url.searchParams.set('api-version', '7.0-preview.3')
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
    body: (params) => ({ text: params.text }),
  },

  transformResponse: async (response) => {
    const raw: AzureDevOpsRawComment = await response.json()
    const comment: AzureDevOpsComment = mapComment(raw)

    return {
      success: true,
      output: {
        content: `Added comment #${comment.commentId}:\n\n${formatComment(comment)}`,
        metadata: { comment },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable confirmation of the added comment',
    },
    metadata: {
      type: 'object',
      description: 'Added comment metadata',
      properties: {
        comment: {
          type: 'object',
          description: 'Full details of the created comment',
          properties: {
            workItemId: { type: 'number', description: 'Work item the comment belongs to' },
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
              description: 'Display name of the comment author, or null',
              nullable: true,
            },
            createdDate: { type: 'string', description: 'ISO timestamp when comment was created' },
            modifiedBy: {
              type: 'string',
              description: 'Display name of the last modifier, or null',
              nullable: true,
            },
            modifiedDate: {
              type: 'string',
              description: 'ISO timestamp when comment was modified',
            },
            isDeleted: { type: 'boolean', description: 'Whether the comment is deleted' },
            url: { type: 'string', description: 'API URL for the comment' },
          },
        },
      },
    },
  },
}
