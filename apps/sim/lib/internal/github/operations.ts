import { createLogger } from '@sim/logger'
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
import type { LatestCommitParams, LatestCommitResponse } from '@/tools/github/types'

const logger = createLogger('GitHubLatestCommitOperation')
const MAX_COMMIT_RESPONSE_BYTES = 10 * 1024 * 1024

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
