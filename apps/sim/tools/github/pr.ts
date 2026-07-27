import {
  isRecord,
  nullableString,
  optionalString,
  readGitHubErrorMessage,
  requiredNumber,
  requiredString,
} from '@/tools/github/response-parsers'
import type {
  GitHubPullRequestBranch,
  GitHubPullRequestFile,
  GitHubPullRequestUser,
  GitHubPullRequestV2Output,
  PROperationParams,
  PRV2OperationParams,
  PullRequestResponse,
  PullRequestV2Response,
} from '@/tools/github/types'
import { BRANCH_REF_OUTPUT, PR_FILE_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

type GitHubPullRequest = Omit<GitHubPullRequestV2Output, 'files'>

type PullRequestFilesResult =
  | { success: true; files: GitHubPullRequestFile[] }
  | { success: false; error: string }

const PULL_REQUEST_FILES_PER_PAGE = 100
const MAX_PULL_REQUEST_FILES = 3_000

function requiredBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new Error(`${context}.${key} must be a boolean`)
  return value
}

function nullableBoolean(
  record: Record<string, unknown>,
  key: string,
  context: string
): boolean | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${context}.${key} must be a boolean or null`)
  return value
}

function parsePullRequestUser(value: unknown, context: string): GitHubPullRequestUser {
  if (!isRecord(value)) throw new Error(`${context} must be an object`)

  return {
    login: requiredString(value, 'login', context),
    id: requiredNumber(value, 'id', context),
    avatar_url: requiredString(value, 'avatar_url', context),
    html_url: requiredString(value, 'html_url', context),
    type: requiredString(value, 'type', context),
  }
}

function parseNullablePullRequestUser(
  value: unknown,
  context: string
): GitHubPullRequestUser | null {
  if (value === null) return null
  return parsePullRequestUser(value, context)
}

function parsePullRequestBranch(value: unknown, context: string): GitHubPullRequestBranch {
  if (!isRecord(value)) throw new Error(`${context} must be an object`)

  return {
    label: requiredString(value, 'label', context),
    ref: requiredString(value, 'ref', context),
    sha: requiredString(value, 'sha', context),
  }
}

function parsePullRequest(value: unknown): GitHubPullRequest {
  if (!isRecord(value)) throw new Error('GitHub pull request response must be an object')

  return {
    id: requiredNumber(value, 'id', 'pull_request'),
    number: requiredNumber(value, 'number', 'pull_request'),
    title: requiredString(value, 'title', 'pull_request'),
    state: requiredString(value, 'state', 'pull_request'),
    html_url: requiredString(value, 'html_url', 'pull_request'),
    diff_url: requiredString(value, 'diff_url', 'pull_request'),
    body: nullableString(value, 'body', 'pull_request'),
    user: parsePullRequestUser(value.user, 'pull_request.user'),
    head: parsePullRequestBranch(value.head, 'pull_request.head'),
    base: parsePullRequestBranch(value.base, 'pull_request.base'),
    merged: requiredBoolean(value, 'merged', 'pull_request'),
    mergeable: nullableBoolean(value, 'mergeable', 'pull_request'),
    merged_by: parseNullablePullRequestUser(value.merged_by, 'pull_request.merged_by'),
    comments: requiredNumber(value, 'comments', 'pull_request'),
    review_comments: requiredNumber(value, 'review_comments', 'pull_request'),
    commits: requiredNumber(value, 'commits', 'pull_request'),
    additions: requiredNumber(value, 'additions', 'pull_request'),
    deletions: requiredNumber(value, 'deletions', 'pull_request'),
    changed_files: requiredNumber(value, 'changed_files', 'pull_request'),
    created_at: requiredString(value, 'created_at', 'pull_request'),
    updated_at: requiredString(value, 'updated_at', 'pull_request'),
    closed_at: nullableString(value, 'closed_at', 'pull_request'),
    merged_at: nullableString(value, 'merged_at', 'pull_request'),
  }
}

function parsePullRequestFile(value: unknown, index: number): GitHubPullRequestFile {
  const context = `pull_request_files[${index}]`
  if (!isRecord(value)) throw new Error(`${context} must be an object`)

  const patch = optionalString(value, 'patch', context)
  const previousFilename = optionalString(value, 'previous_filename', context)

  return {
    sha: requiredString(value, 'sha', context),
    filename: requiredString(value, 'filename', context),
    status: requiredString(value, 'status', context),
    additions: requiredNumber(value, 'additions', context),
    deletions: requiredNumber(value, 'deletions', context),
    changes: requiredNumber(value, 'changes', context),
    blob_url: requiredString(value, 'blob_url', context),
    raw_url: requiredString(value, 'raw_url', context),
    contents_url: requiredString(value, 'contents_url', context),
    ...(patch === undefined ? {} : { patch }),
    ...(previousFilename === undefined ? {} : { previous_filename: previousFilename }),
  }
}

function parsePullRequestFiles(value: unknown): GitHubPullRequestFile[] {
  if (!Array.isArray(value)) throw new Error('GitHub pull request files response must be an array')
  return value.map(parsePullRequestFile)
}

async function parsePullRequestResponse(response: Response): Promise<GitHubPullRequest> {
  if (!response.ok) {
    throw new Error(
      (await readGitHubErrorMessage(response)) ??
        `Failed to fetch pull request (HTTP ${response.status})`
    )
  }

  const value: unknown = await response.json()
  return parsePullRequest(value)
}

async function fetchPullRequestFiles(
  params: PROperationParams,
  pullNumber: number
): Promise<PullRequestFilesResult> {
  const files: GitHubPullRequestFile[] = []
  const maxPages = MAX_PULL_REQUEST_FILES / PULL_REQUEST_FILES_PER_PAGE

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${pullNumber}/files?per_page=${PULL_REQUEST_FILES_PER_PAGE}&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${params.apiKey}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )

    if (!response.ok) {
      return {
        success: false,
        error:
          (await readGitHubErrorMessage(response)) ??
          `Failed to fetch PR files (HTTP ${response.status})`,
      }
    }

    const value: unknown = await response.json()
    const pageFiles = parsePullRequestFiles(value)
    if (pageFiles.length > PULL_REQUEST_FILES_PER_PAGE) {
      throw new Error(
        `GitHub returned more than ${PULL_REQUEST_FILES_PER_PAGE} pull request files in one page`
      )
    }
    files.push(...pageFiles)
    if (pageFiles.length < PULL_REQUEST_FILES_PER_PAGE) break
  }

  return { success: true, files }
}

function requireParams<T extends PROperationParams>(params: T | undefined): T {
  if (!params) throw new Error('GitHub PR reader parameters are required')
  return params
}

const PR_PARAMS = {
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
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'GitHub API token',
  },
} satisfies ToolConfig<PROperationParams, PullRequestResponse>['params']

export const prTool: ToolConfig<PROperationParams, PullRequestResponse> = {
  id: 'github_pr',
  name: 'GitHub PR Reader',
  description: 'Fetch PR details including diff and files changed',
  version: '1.0.0',

  params: PR_PARAMS,

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    const requestParams = requireParams(params)
    const pr = await parsePullRequestResponse(response)
    const filesResult = await fetchPullRequestFiles(requestParams, pr.number)

    if (!filesResult.success) {
      return {
        success: false,
        error: filesResult.error,
        output: {
          content: '',
          metadata: {
            number: pr.number,
            title: pr.title,
            state: pr.state,
            html_url: pr.html_url,
            diff_url: pr.diff_url,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            files: [],
          },
        },
      }
    }

    const content = `PR #${pr.number}: "${pr.title}" (${pr.state}) - Created: ${pr.created_at}, Updated: ${pr.updated_at}
Description: ${pr.body || 'No description'}
Files changed: ${filesResult.files.length}
URL: ${pr.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
          diff_url: pr.diff_url,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          files: filesResult.files.map((file) => ({
            filename: file.filename,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch,
            blob_url: file.blob_url,
            raw_url: file.raw_url,
            status: file.status,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable PR summary' },
    metadata: {
      type: 'object',
      description: 'Detailed PR metadata including file changes',
      properties: {
        number: { type: 'number', description: 'Pull request number' },
        title: { type: 'string', description: 'PR title' },
        state: { type: 'string', description: 'PR state (open/closed/merged)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        diff_url: { type: 'string', description: 'Raw diff URL' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        files: {
          type: 'array',
          description: 'Files changed in the PR',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'File path' },
              additions: { type: 'number', description: 'Lines added' },
              deletions: { type: 'number', description: 'Lines deleted' },
              changes: { type: 'number', description: 'Total changes' },
              patch: { type: 'string', description: 'File diff patch', optional: true },
              blob_url: { type: 'string', description: 'GitHub blob URL' },
              raw_url: { type: 'string', description: 'Raw file URL' },
              status: { type: 'string', description: 'Change type (added/modified/deleted)' },
            },
          },
        },
      },
    },
  },
}

export const prV2Tool: ToolConfig<PRV2OperationParams, PullRequestV2Response> = {
  id: 'github_pr_v2',
  name: prTool.name,
  description: prTool.description,
  version: '2.0.0',
  params: {
    ...PR_PARAMS,
    includeFiles: {
      type: 'boolean',
      required: false,
      default: true,
      visibility: 'user-or-llm',
      description: 'Whether to fetch changed-file details from the separate files endpoint',
    },
  },
  request: prTool.request,

  transformResponse: async (response: Response, params) => {
    const requestParams = requireParams(params)
    const pr = await parsePullRequestResponse(response)

    if (requestParams.includeFiles !== false) {
      const filesResult = await fetchPullRequestFiles(requestParams, pr.number)
      if (!filesResult.success) {
        return {
          success: false,
          error: filesResult.error,
          output: {
            ...pr,
          },
        }
      }

      return {
        success: true,
        output: {
          ...pr,
          files: filesResult.files,
        },
      }
    }

    return {
      success: true,
      output: {
        ...pr,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Pull request ID' },
    number: { type: 'number', description: 'Pull request number' },
    title: { type: 'string', description: 'PR title' },
    state: { type: 'string', description: 'PR state (open/closed)' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    diff_url: { type: 'string', description: 'Raw diff URL' },
    body: { type: 'string', description: 'PR description', nullable: true },
    user: USER_OUTPUT,
    head: BRANCH_REF_OUTPUT,
    base: BRANCH_REF_OUTPUT,
    merged: { type: 'boolean', description: 'Whether PR is merged' },
    mergeable: { type: 'boolean', description: 'Whether PR is mergeable', nullable: true },
    merged_by: { ...USER_OUTPUT, nullable: true },
    comments: { type: 'number', description: 'Number of comments' },
    review_comments: { type: 'number', description: 'Number of review comments' },
    commits: { type: 'number', description: 'Number of commits' },
    additions: { type: 'number', description: 'Lines added' },
    deletions: { type: 'number', description: 'Lines deleted' },
    changed_files: { type: 'number', description: 'Number of changed files' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    closed_at: { type: 'string', description: 'Close timestamp', nullable: true },
    merged_at: { type: 'string', description: 'Merge timestamp', nullable: true },
    files: {
      type: 'array',
      description: 'Array of changed file objects',
      optional: true,
      items: {
        type: 'object',
        properties: PR_FILE_OUTPUT_PROPERTIES,
      },
    },
  },
}
