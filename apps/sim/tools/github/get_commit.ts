import type { ToolConfig } from '@/tools/types'

interface GetCommitParams {
  owner: string
  repo: string
  ref: string
  apiKey: string
}

interface GetCommitResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      sha: string
      html_url: string
      message: string
      author: { name: string; email: string; date: string; login?: string }
      committer: { name: string; email: string; date: string; login?: string }
      stats: { additions: number; deletions: number; total: number }
      files: Array<{
        filename: string
        status: string
        additions: number
        deletions: number
        changes: number
        patch?: string
      }>
      parents: Array<{ sha: string; html_url: string }>
    }
  }
}

export const getCommitTool: ToolConfig<GetCommitParams, GetCommitResponse> = {
  id: 'github_get_commit',
  name: 'GitHub Get Commit',
  description: 'Get detailed information about a specific commit including files changed and stats',
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
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Commit SHA, branch name, or tag name',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/commits/${params.ref}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const files = (data.files ?? []).map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    }))

    const metadata = {
      sha: data.sha,
      html_url: data.html_url,
      message: data.commit.message,
      author: {
        name: data.commit.author.name,
        email: data.commit.author.email,
        date: data.commit.author.date,
        login: data.author?.login,
      },
      committer: {
        name: data.commit.committer.name,
        email: data.commit.committer.email,
        date: data.commit.committer.date,
        login: data.committer?.login,
      },
      stats: data.stats ?? { additions: 0, deletions: 0, total: 0 },
      files,
      parents: data.parents.map((p: any) => ({ sha: p.sha, html_url: p.html_url })),
    }

    const content = `Commit ${data.sha.substring(0, 7)}
Message: ${data.commit.message.split('\n')[0]}
Author: ${metadata.author.login ?? metadata.author.name} (${metadata.author.date})
Stats: +${metadata.stats.additions} -${metadata.stats.deletions} (${files.length} files)
${data.html_url}

Files changed:
${files.map((f: any) => `  ${f.status}: ${f.filename} (+${f.additions} -${f.deletions})`).join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable commit details' },
    metadata: {
      type: 'object',
      description: 'Commit metadata',
      properties: {
        sha: { type: 'string', description: 'Full commit SHA' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        message: { type: 'string', description: 'Commit message' },
        author: { type: 'object', description: 'Author info' },
        committer: { type: 'object', description: 'Committer info' },
        stats: {
          type: 'object',
          description: 'Change stats',
          properties: {
            additions: { type: 'number', description: 'Lines added' },
            deletions: { type: 'number', description: 'Lines deleted' },
            total: { type: 'number', description: 'Total changes' },
          },
        },
        files: {
          type: 'array',
          description: 'Changed files',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'File path' },
              status: { type: 'string', description: 'Change type' },
              additions: { type: 'number', description: 'Lines added' },
              deletions: { type: 'number', description: 'Lines deleted' },
              changes: { type: 'number', description: 'Total changes' },
              patch: { type: 'string', description: 'Diff patch', optional: true },
            },
          },
        },
        parents: { type: 'array', description: 'Parent commits' },
      },
    },
  },
}

export const getCommitV2Tool: ToolConfig<GetCommitParams, any> = {
  id: 'github_get_commit_v2',
  name: getCommitTool.name,
  description: getCommitTool.description,
  version: '2.0.0',
  params: getCommitTool.params,
  request: getCommitTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ...data,
        author: data.author ?? null,
        committer: data.committer ?? null,
        stats: data.stats ?? null,
        files: data.files ?? [],
      },
    }
  },

  outputs: {
    sha: { type: 'string', description: 'Commit SHA' },
    node_id: { type: 'string', description: 'GraphQL node ID' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    url: { type: 'string', description: 'API URL' },
    comments_url: { type: 'string', description: 'Comments API URL' },
    commit: {
      type: 'object',
      description: 'Core commit data',
      properties: {
        url: { type: 'string', description: 'Commit API URL' },
        message: { type: 'string', description: 'Commit message' },
        comment_count: { type: 'number', description: 'Number of comments' },
        author: {
          type: 'object',
          description: 'Git author',
          properties: {
            name: { type: 'string', description: 'Author name' },
            email: { type: 'string', description: 'Author email' },
            date: { type: 'string', description: 'Author date (ISO 8601)' },
          },
        },
        committer: {
          type: 'object',
          description: 'Git committer',
          properties: {
            name: { type: 'string', description: 'Committer name' },
            email: { type: 'string', description: 'Committer email' },
            date: { type: 'string', description: 'Commit date (ISO 8601)' },
          },
        },
        tree: {
          type: 'object',
          description: 'Tree object',
          properties: {
            sha: { type: 'string', description: 'Tree SHA' },
            url: { type: 'string', description: 'Tree API URL' },
          },
        },
        verification: {
          type: 'object',
          description: 'Signature verification',
          properties: {
            verified: { type: 'boolean', description: 'Whether signature is verified' },
            reason: { type: 'string', description: 'Verification reason' },
            signature: { type: 'string', description: 'GPG signature', optional: true },
            payload: { type: 'string', description: 'Signed payload', optional: true },
          },
        },
      },
    },
    author: {
      type: 'object',
      description: 'GitHub user (author)',
      optional: true,
      properties: {
        login: { type: 'string', description: 'Username' },
        id: { type: 'number', description: 'User ID' },
        avatar_url: { type: 'string', description: 'Avatar URL' },
        html_url: { type: 'string', description: 'Profile URL' },
        type: { type: 'string', description: 'User or Organization' },
      },
    },
    committer: {
      type: 'object',
      description: 'GitHub user (committer)',
      optional: true,
      properties: {
        login: { type: 'string', description: 'Username' },
        id: { type: 'number', description: 'User ID' },
        avatar_url: { type: 'string', description: 'Avatar URL' },
        html_url: { type: 'string', description: 'Profile URL' },
        type: { type: 'string', description: 'User or Organization' },
      },
    },
    stats: {
      type: 'object',
      description: 'Change statistics',
      optional: true,
      properties: {
        additions: { type: 'number', description: 'Lines added' },
        deletions: { type: 'number', description: 'Lines deleted' },
        total: { type: 'number', description: 'Total changes' },
      },
    },
    files: {
      type: 'array',
      description: 'Changed files (diff entries)',
      items: {
        type: 'object',
        properties: {
          sha: { type: 'string', description: 'Blob SHA', optional: true },
          filename: { type: 'string', description: 'File path' },
          status: {
            type: 'string',
            description:
              'Change status (added, removed, modified, renamed, copied, changed, unchanged)',
          },
          additions: { type: 'number', description: 'Lines added' },
          deletions: { type: 'number', description: 'Lines deleted' },
          changes: { type: 'number', description: 'Total changes' },
          blob_url: { type: 'string', description: 'Blob URL' },
          raw_url: { type: 'string', description: 'Raw file URL' },
          contents_url: { type: 'string', description: 'Contents API URL' },
          patch: { type: 'string', description: 'Diff patch', optional: true },
          previous_filename: {
            type: 'string',
            description: 'Previous filename (for renames)',
            optional: true,
          },
        },
      },
    },
    parents: {
      type: 'array',
      description: 'Parent commits',
      items: {
        type: 'object',
        properties: {
          sha: { type: 'string', description: 'Parent SHA' },
          url: { type: 'string', description: 'Parent API URL' },
          html_url: { type: 'string', description: 'Parent web URL' },
        },
      },
    },
  },
}
