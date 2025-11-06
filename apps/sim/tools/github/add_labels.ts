import type { AddLabelsParams, LabelsResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const addLabelsTool: ToolConfig<AddLabelsParams, LabelsResponse> = {
  id: 'github_add_labels',
  name: 'GitHub Add Labels',
  description: 'Add labels to an issue in a GitHub repository',
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
    labels: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of label names to add to the issue',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/labels`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const labelsArray = params.labels
        .split(',')
        .map((l) => l.trim())
        .filter((l) => l)
      return {
        labels: labelsArray,
      }
    },
  },

  transformResponse: async (response) => {
    const labelsData = await response.json()

    const labels = labelsData.map((label: any) => label.name)

    const content = `Labels added to issue successfully!
All labels on issue: ${labels.join(', ')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          labels,
          issue_number: 0, // Will be filled from params in actual implementation
          html_url: '', // Will be constructed from params
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable labels confirmation' },
    metadata: {
      type: 'object',
      description: 'Labels metadata',
      properties: {
        labels: { type: 'array', description: 'All labels currently on the issue' },
        issue_number: { type: 'number', description: 'Issue number' },
        html_url: { type: 'string', description: 'GitHub issue URL' },
      },
    },
  },
}
