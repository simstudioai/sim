import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { GitHubOperationError } from '@/lib/internal/github/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { formatGitHubErrorMessage } from '@/tools/github/response-parsers'
import type {
  CreateCommentParams,
  LatestCommitParams,
  LatestCommitResponse,
} from '@/tools/github/types'
import { secureGitHubRequest } from '@/tools/github/utils.server'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('GitHubLatestCommitOperation')
const MAX_COMMIT_RESPONSE_BYTES = 10 * 1024 * 1024
const GITHUB_API_BASE = 'https://api.github.com'

interface ReviewCommentBody {
  body: string
  event: 'COMMENT'
}

interface FileCommentBody {
  body: string
  commit_id: string | undefined
  path: string | undefined
  line: number | undefined
  side: string
}

interface GitHubCommentPayload {
  id?: number
  body?: string
  html_url?: string
  user?: unknown
  path?: string
  line?: number
  position?: number
  side?: string
  commit_id?: string
  created_at?: string
  updated_at?: string
}

interface GitHubCommitFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
  raw_url?: string
  blob_url?: string
}

interface GitHubCommitResponse {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; email: string; date: string }
    committer: { name: string; email: string; date: string }
  }
  author?: { login: string; avatar_url: string; html_url: string }
  committer?: { login: string; avatar_url: string; html_url: string }
  stats?: { additions: number; deletions: number; total: number }
  files?: GitHubCommitFile[]
}

interface GitHubCommitFileOutput extends Omit<GitHubCommitFile, 'raw_url' | 'blob_url'> {
  raw_url: string
  blob_url: string
  content?: string
}

export interface GitHubOperationContext {
  requestId: string
  signal?: AbortSignal
}

function githubHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${apiKey}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function pullRequestUrl(params: CreateCommentParams): string {
  return `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`
}

function isFileCommentRequest(params: CreateCommentParams): boolean {
  return params.commentType === 'file_comment' && Boolean(params.path)
}

function needsCommitLookup(params: CreateCommentParams): boolean {
  return isFileCommentRequest(params) && !params.commitId
}

function toLineNumber(value: unknown): number | undefined {
  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else {
    if (typeof value !== 'string' || !value.trim()) return undefined
    parsed = Number(value.trim())
  }
  if (!Number.isFinite(parsed)) return undefined
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `GitHub line numbers are whole numbers, but line was ${parsed}. Set line to the integer line number in the diff.`
    )
  }
  return parsed
}

function fileCommentBody(
  params: CreateCommentParams,
  commitId: string | undefined
): FileCommentBody {
  return {
    body: params.body,
    commit_id: commitId,
    path: params.path,
    line: toLineNumber(params.line),
    side: params.side || 'RIGHT',
  }
}

function commentEndpointUrl(params: CreateCommentParams): string {
  return isFileCommentRequest(params)
    ? `${pullRequestUrl(params)}/comments`
    : `${pullRequestUrl(params)}/reviews`
}

function commentRequestBody(
  params: CreateCommentParams,
  commitId: string | undefined
): FileCommentBody | ReviewCommentBody {
  if (params.commentType === 'file_comment') return fileCommentBody(params, commitId)
  return { body: params.body, event: 'COMMENT' }
}

function readHeadSha(pullRequest: unknown): string | undefined {
  if (!isRecordLike(pullRequest) || !isRecordLike(pullRequest.head)) return undefined
  const sha = pullRequest.head.sha
  return typeof sha === 'string' && sha ? sha : undefined
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function readCommentPayload(value: unknown): GitHubCommentPayload {
  if (!isRecordLike(value)) return {}
  return {
    id: readNumber(value, 'id'),
    body: readString(value, 'body'),
    html_url: readString(value, 'html_url'),
    user: value.user,
    path: readString(value, 'path'),
    line: readNumber(value, 'line'),
    position: readNumber(value, 'position'),
    side: readString(value, 'side'),
    commit_id: readString(value, 'commit_id'),
    created_at: readString(value, 'created_at'),
    updated_at: readString(value, 'updated_at'),
  }
}

async function assertGitHubResponseOk(
  response: Response,
  fallback: string,
  signal?: AbortSignal
): Promise<void> {
  if (response.ok) return

  const text = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'GitHub error response',
    signal,
  }).catch(() => '')
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  throw new GitHubOperationError(
    formatGitHubErrorMessage(data) ?? `${fallback} (HTTP ${response.status})`,
    response.status
  )
}

async function createComment(
  params: CreateCommentParams,
  signal?: AbortSignal
): Promise<GitHubCommentPayload> {
  const headers = githubHeaders(params.apiKey)

  let commitId = params.commitId
  if (needsCommitLookup(params)) {
    const pullRequestResponse = await secureGitHubRequest(pullRequestUrl(params), {
      headers,
      signal,
    })
    await assertGitHubResponseOk(
      pullRequestResponse,
      `Failed to load pull request ${params.owner}/${params.repo}#${params.pullNumber}`,
      signal
    )
    const pullRequest = await readResponseJsonWithLimit<unknown>(pullRequestResponse, {
      maxBytes: MAX_COMMIT_RESPONSE_BYTES,
      label: 'GitHub pull request response',
      signal,
    })
    commitId = readHeadSha(pullRequest)
    if (!commitId) {
      throw new Error(
        `GitHub returned no head commit SHA for pull request ${params.owner}/${params.repo}#${params.pullNumber}. Set commitId to comment on a specific commit.`
      )
    }
  }

  const response = await secureGitHubRequest(commentEndpointUrl(params), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(commentRequestBody(params, commitId)),
    signal,
  })
  await assertGitHubResponseOk(response, 'Failed to create comment', signal)
  return readCommentPayload(
    await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_COMMIT_RESPONSE_BYTES,
      label: 'GitHub comment response',
      signal,
    })
  )
}

export async function executeGitHubCommentOperation(
  params: CreateCommentParams,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const data = await createComment(params, signal)
  return {
    success: true,
    output: {
      content: `Comment created: "${data.body}"`,
      metadata: {
        id: data.id,
        html_url: data.html_url,
        created_at: data.created_at,
        updated_at: data.updated_at,
        path: data.path,
        line: data.line || data.position,
        side: data.side,
        commit_id: data.commit_id,
      },
    },
  }
}

export async function executeGitHubCommentV2Operation(
  params: CreateCommentParams,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const data = await createComment(params, signal)
  return {
    success: true,
    output: {
      id: data.id,
      body: data.body,
      html_url: data.html_url,
      user: data.user,
      path: data.path ?? null,
      line: data.line ?? data.position ?? null,
      side: data.side ?? null,
      commit_id: data.commit_id ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
  }
}

async function fetchChangedFileContent(
  file: GitHubCommitFile,
  apiKey: string,
  remainingBytes: number,
  context: GitHubOperationContext
): Promise<string | undefined> {
  if (file.status === 'removed' || !file.raw_url || remainingBytes <= 0) return undefined
  try {
    const validation = await validateUrlWithDNS(file.raw_url, 'rawUrl')
    context.signal?.throwIfAborted()
    if (!validation.isValid || !validation.resolvedIP) return undefined
    const response = await secureFetchWithPinnedIP(file.raw_url, validation.resolvedIP, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      maxResponseBytes: remainingBytes,
      signal: context.signal,
    })
    if (!response.ok) return undefined
    return await readResponseTextWithLimit(response, {
      maxBytes: remainingBytes,
      label: `GitHub changed file ${file.filename}`,
      signal: context.signal,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.warn('Failed to fetch changed file content', {
      requestId: context.requestId,
      filename: file.filename,
      error,
    })
    return undefined
  }
}

export async function getGitHubLatestCommit(
  input: LatestCommitParams,
  context: GitHubOperationContext
): Promise<LatestCommitResponse> {
  context.signal?.throwIfAborted()
  const owner = encodeURIComponent(input.owner)
  const repo = encodeURIComponent(input.repo)
  const revision = encodeURIComponent(input.branch || 'HEAD')
  const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${revision}`
  const validation = await validateUrlWithDNS(commitUrl, 'commitUrl')
  context.signal?.throwIfAborted()
  if (!validation.isValid || !validation.resolvedIP) {
    throw new GitHubOperationError(validation.error || 'Invalid GitHub commit URL', 400)
  }

  const response = await secureFetchWithPinnedIP(commitUrl, validation.resolvedIP, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${input.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    maxResponseBytes: MAX_COMMIT_RESPONSE_BYTES,
    signal: context.signal,
  })
  if (!response.ok) {
    const error = await readResponseJsonWithLimit<{ message?: string }>(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'GitHub error response',
      signal: context.signal,
    }).catch(() => ({ message: undefined }))
    throw new GitHubOperationError(error.message || `GitHub API error: ${response.status}`, 400)
  }

  const data = await readResponseJsonWithLimit<GitHubCommitResponse>(response, {
    maxBytes: MAX_COMMIT_RESPONSE_BYTES,
    label: 'GitHub latest commit response',
    signal: context.signal,
  })
  const files: GitHubCommitFileOutput[] = []
  let remainingBytes = MAX_BUFFERED_TRANSFER_BYTES
  for (const file of data.files ?? []) {
    context.signal?.throwIfAborted()
    const content = await fetchChangedFileContent(file, input.apiKey, remainingBytes, context)
    if (content) remainingBytes -= Buffer.byteLength(content)
    files.push({
      ...file,
      raw_url: file.raw_url || '',
      blob_url: file.blob_url || '',
      content,
    })
  }

  return {
    success: true,
    output: {
      content: `Latest commit: "${data.commit.message}" by ${data.commit.author.name} on ${data.commit.author.date}. SHA: ${data.sha}`,
      metadata: {
        sha: data.sha,
        html_url: data.html_url,
        commit_message: data.commit.message,
        author: {
          name: data.commit.author.name,
          login: data.author?.login || 'Unknown',
          avatar_url: data.author?.avatar_url || '',
          html_url: data.author?.html_url || '',
        },
        committer: {
          name: data.commit.committer.name,
          login: data.committer?.login || 'Unknown',
          avatar_url: data.committer?.avatar_url || '',
          html_url: data.committer?.html_url || '',
        },
        stats: data.stats,
        files: files.length > 0 ? files : undefined,
      },
    },
  }
}
