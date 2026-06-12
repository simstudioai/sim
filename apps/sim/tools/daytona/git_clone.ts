import type { DaytonaGitCloneParams, DaytonaGitCloneResponse } from '@/tools/daytona/types'
import { daytonaToolboxUrl, extractDaytonaError } from '@/tools/daytona/utils'
import type { ToolConfig } from '@/tools/types'

export const daytonaGitCloneTool: ToolConfig<DaytonaGitCloneParams, DaytonaGitCloneResponse> = {
  id: 'daytona_git_clone',
  name: 'Daytona Git Clone',
  description: 'Clone a Git repository into a Daytona sandbox',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Daytona API key',
    },
    sandboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the sandbox to clone the repository into',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the Git repository to clone',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path in the sandbox to clone the repository into',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch to clone (defaults to the default branch)',
    },
    commitId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific commit to check out after cloning',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username for authenticating to private repositories',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password or personal access token for private repositories',
    },
  },

  request: {
    url: (params) => daytonaToolboxUrl(params.sandboxId, '/git/clone'),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        url: params.url,
        path: params.path,
      }
      if (params.branch) body.branch = params.branch
      if (params.commitId) body.commit_id = params.commitId
      if (params.username) body.username = params.username
      if (params.password) body.password = params.password
      return body
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to clone repository'))
    }
    return {
      success: true,
      output: {
        repoUrl: params?.url ?? '',
        clonePath: params?.path ?? '',
      },
    }
  },

  outputs: {
    repoUrl: { type: 'string', description: 'URL of the cloned repository' },
    clonePath: { type: 'string', description: 'Path the repository was cloned into' },
  },
}
