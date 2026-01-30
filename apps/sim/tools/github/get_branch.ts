import type { BranchResponse, GetBranchParams } from '@/tools/github/types'
import { BRANCH_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getBranchTool: ToolConfig<GetBranchParams, BranchResponse> = {
  id: 'github_get_branch',
  name: 'GitHub Get Branch',
  description:
    'Get detailed information about a specific branch in a GitHub repository, including commit details and protection status.',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner (user or organization)',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Branch name',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/branches/${params.branch}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const branch = await response.json()

    const content = `Branch: ${branch.name}
Commit SHA: ${branch.commit.sha}
Commit URL: ${branch.commit.url}
Protected: ${branch.protected ? 'Yes' : 'No'}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          name: branch.name,
          commit: {
            sha: branch.commit.sha,
            url: branch.commit.url,
          },
          protected: branch.protected,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable branch details' },
    metadata: {
      type: 'object',
      description: 'Branch metadata',
      properties: {
        name: { type: 'string', description: 'Branch name' },
        commit: {
          type: 'object',
          description: 'Commit information',
          properties: {
            sha: { type: 'string', description: 'Commit SHA' },
            url: { type: 'string', description: 'Commit API URL' },
          },
        },
        protected: { type: 'boolean', description: 'Whether branch is protected' },
      },
    },
  },
}

export const getBranchV2Tool: ToolConfig<GetBranchParams, any> = {
  id: 'github_get_branch_v2',
  name: getBranchTool.name,
  description: getBranchTool.description,
  version: '2.0.0',
  params: getBranchTool.params,
  request: getBranchTool.request,

  transformResponse: async (response: Response) => {
    const branch = await response.json()
    return {
      success: true,
      output: {
        name: branch.name,
        commit: branch.commit,
        protected: branch.protected,
        protection: branch.protection,
        protection_url: branch.protection_url,
      },
    }
  },

  outputs: {
    ...BRANCH_OUTPUT_PROPERTIES,
    protection: { type: 'json', description: 'Protection settings object' },
    protection_url: { type: 'string', description: 'URL to protection settings' },
  },
}
