import type { LabelsResponse, RemoveLabelParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const removeLabelTool: ToolConfig<RemoveLabelParams, LabelsResponse> = {
  id: 'github_remove_label',
  name: 'GitHub Remove Label',
  description: 'Remove a label from an issue in a GitHub repository',
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
    issue_number: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue number',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Label name to remove',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/labels/${encodeURIComponent(params.name)}`,
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    if (!params) {
      return {
        success: false,
        error: 'Missing parameters',
        output: {
          content: '',
          metadata: {
            labels: [],
            issue_number: 0,
            html_url: '',
          },
        },
      }
    }

    const labelsData = await response.json()

    const labels = labelsData.map((label: any) => label.name)

    const content = `Label "${params.name}" removed from issue #${params.issue_number}
${labels.length > 0 ? `Remaining labels: ${labels.join(', ')}` : 'No labels remaining on this issue'}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          labels,
          issue_number: params.issue_number,
          html_url: `https://github.com/${params.owner}/${params.repo}/issues/${params.issue_number}`,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable label removal confirmation' },
    metadata: {
      type: 'object',
      description: 'Remaining labels metadata',
      properties: {
        labels: { type: 'array', description: 'Labels remaining on the issue after removal' },
        issue_number: { type: 'number', description: 'Issue number' },
        html_url: { type: 'string', description: 'GitHub issue URL' },
      },
    },
  },
}
