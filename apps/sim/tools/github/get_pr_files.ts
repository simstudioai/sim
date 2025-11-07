import type { GetPRFilesParams, PRFilesListResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getPRFilesTool: ToolConfig<GetPRFilesParams, PRFilesListResponse> = {
  id: 'github_get_pr_files',
  name: 'GitHub Get PR Files',
  description: 'Get the list of files changed in a pull request',
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
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max 100)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number',
      default: 1,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/files`
      )
      if (params.per_page) url.searchParams.append('per_page', Number(params.per_page).toString())
      if (params.page) url.searchParams.append('page', Number(params.page).toString())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const files = await response.json()

    const totalAdditions = files.reduce((sum: number, file: any) => sum + file.additions, 0)
    const totalDeletions = files.reduce((sum: number, file: any) => sum + file.deletions, 0)
    const totalChanges = files.reduce((sum: number, file: any) => sum + file.changes, 0)

    const content = `Found ${files.length} file(s) changed in PR
Total additions: ${totalAdditions}, Total deletions: ${totalDeletions}, Total changes: ${totalChanges}

Files:
${files
  .map(
    (file: any) =>
      `- ${file.filename} (${file.status})
  +${file.additions} -${file.deletions} (~${file.changes} changes)`
  )
  .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          files: files.map((file: any) => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch,
            blob_url: file.blob_url,
            raw_url: file.raw_url,
          })),
          total_count: files.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of files changed in PR' },
    metadata: {
      type: 'object',
      description: 'PR files metadata',
      properties: {
        files: {
          type: 'array',
          description: 'Array of file changes',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'File path' },
              status: {
                type: 'string',
                description: 'Change type (added/modified/deleted/renamed)',
              },
              additions: { type: 'number', description: 'Lines added' },
              deletions: { type: 'number', description: 'Lines deleted' },
              changes: { type: 'number', description: 'Total changes' },
              patch: { type: 'string', description: 'File diff patch' },
              blob_url: { type: 'string', description: 'GitHub blob URL' },
              raw_url: { type: 'string', description: 'Raw file URL' },
            },
          },
        },
        total_count: { type: 'number', description: 'Total number of files changed' },
      },
    },
  },
}
