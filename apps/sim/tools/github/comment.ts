import type { CreateCommentParams, CreateCommentResponse } from '@/tools/github/types'
import { COMMENT_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const commentTool: InternalToolConfig<CreateCommentParams, CreateCommentResponse> = {
  id: 'github_comment',
  name: 'GitHub PR Commenter',
  description: 'Create comments on GitHub PRs',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment content',
    },
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'File path for review comment',
    },
    commentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of comment (pr_comment or file_comment)',
    },
    line: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Line number for review comment',
    },
    side: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Side of the diff (LEFT or RIGHT)',
      default: 'RIGHT',
    },
    commitId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The SHA of the commit to comment on. Defaults to the pull request head commit.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable comment confirmation' },
    metadata: {
      type: 'object',
      description: 'Comment metadata',
    },
  },
}

export const commentV2Tool: InternalToolConfig<CreateCommentParams> = {
  id: 'github_comment_v2',
  name: commentTool.name,
  description: commentTool.description,
  version: '2.0.0',
  params: commentTool.params,
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    ...COMMENT_OUTPUT_PROPERTIES,
    user: USER_OUTPUT,
    path: { type: 'string', description: 'File path (if file comment)', optional: true },
    line: { type: 'number', description: 'Line number', optional: true },
    side: { type: 'string', description: 'Diff side', optional: true },
    commit_id: { type: 'string', description: 'Commit ID', optional: true },
  },
}
