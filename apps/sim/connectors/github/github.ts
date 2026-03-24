import { createLogger } from '@sim/logger'
import { GithubIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('GitHubConnector')

const GITHUB_API_URL = 'https://api.github.com'
const BATCH_SIZE = 30
const GIT_SHA_PREFIX = 'git-sha:'

/**
 * Parses the repository string into owner and repo.
 */
function parseRepo(repository: string): { owner: string; repo: string } {
  const cleaned = repository.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const parts = cleaned.split('/')
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: "${repository}". Use "owner/repo".`)
  }
  return { owner: parts[0], repo: parts[1] }
}

/**
 * File extension filter set from user config. Returns null if no filter (accept all).
 */
function parseExtensions(extensions: string): Set<string> | null {
  const trimmed = extensions.trim()
  if (!trimmed) return null
  const exts = trimmed
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
  return exts.length > 0 ? new Set(exts) : null
}

/**
 * Checks whether a file path matches the extension filter.
 */
function matchesExtension(filePath: string, extSet: Set<string> | null): boolean {
  if (!extSet) return true
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1) return false
  return extSet.has(filePath.slice(lastDot).toLowerCase())
}

interface TreeItem {
  path: string
  mode: string
  type: string
  sha: string
  size?: number
}

/**
 * Fetches the full recursive tree for a branch.
 */
async function fetchTree(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<TreeItem[]> {
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to fetch GitHub tree', { status: response.status, error: errorText })
    throw new Error(`Failed to fetch repository tree: ${response.status}`)
  }

  const data = await response.json()

  if (data.truncated) {
    logger.warn('GitHub tree was truncated — some files may be missing', { owner, repo, branch })
  }

  return (data.tree || []).filter((item: TreeItem) => item.type === 'blob')
}

/**
 * Creates a lightweight stub ExternalDocument from a tree item.
 * Uses the Git blob SHA as contentHash for change detection, avoiding
 * the need to fetch blob content for every file during listing.
 * Content is deferred and only fetched for new/changed documents.
 */
function treeItemToStub(
  owner: string,
  repo: string,
  branch: string,
  item: TreeItem
): ExternalDocument {
  return {
    externalId: item.path,
    title: item.path.split('/').pop() || item.path,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${item.path.split('/').map(encodeURIComponent).join('/')}`,
    contentHash: `${GIT_SHA_PREFIX}${item.sha}`,
    metadata: {
      path: item.path,
      sha: item.sha,
      size: item.size,
      branch,
      repository: `${owner}/${repo}`,
    },
  }
}

export const githubConnector: ConnectorConfig = {
  id: 'github',
  name: 'GitHub',
  description: 'Sync files from a GitHub repository into your knowledge base',
  version: '1.0.0',
  icon: GithubIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },

  configFields: [
    {
      id: 'repository',
      title: 'Repository',
      type: 'short-input',
      placeholder: 'owner/repo',
      required: true,
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'main (default)',
      required: false,
    },
    {
      id: 'pathPrefix',
      title: 'Path Filter',
      type: 'short-input',
      placeholder: 'e.g. docs/, src/components/',
      required: false,
    },
    {
      id: 'extensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'e.g. .md, .txt, .mdx',
      required: false,
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const { owner, repo } = parseRepo(sourceConfig.repository as string)
    const branch = ((sourceConfig.branch as string) || 'main').trim()
    const pathPrefix = ((sourceConfig.pathPrefix as string) || '').trim()
    const extSet = parseExtensions((sourceConfig.extensions as string) || '')
    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0

    let capped: TreeItem[]
    if (syncContext?.filteredTree) {
      capped = syncContext.filteredTree as TreeItem[]
    } else {
      const tree = await fetchTree(accessToken, owner, repo, branch)

      // Filter by path prefix and extensions
      const filtered = tree.filter((item) => {
        if (pathPrefix && !item.path.startsWith(pathPrefix)) return false
        if (!matchesExtension(item.path, extSet)) return false
        return true
      })

      // Apply max files limit
      capped = maxFiles > 0 ? filtered.slice(0, maxFiles) : filtered
      if (syncContext) syncContext.filteredTree = capped
    }

    // Paginate using offset cursor
    const offset = cursor ? Number(cursor) : 0
    const batch = capped.slice(offset, offset + BATCH_SIZE)

    logger.info('Listing GitHub files', {
      owner,
      repo,
      branch,
      totalFiltered: capped.length,
      offset,
      batchSize: batch.length,
    })

    const documents = batch.map((item) => treeItemToStub(owner, repo, branch, item))

    const nextOffset = offset + BATCH_SIZE
    const hasMore = nextOffset < capped.length

    return {
      documents,
      nextCursor: hasMore ? String(nextOffset) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const { owner, repo } = parseRepo(sourceConfig.repository as string)
    const branch = ((sourceConfig.branch as string) || 'main').trim()

    // externalId is the file path
    const path = externalId

    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/')
      const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })

      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`Failed to fetch file ${path}: ${response.status}`)
      }

      const lastModifiedHeader = response.headers.get('last-modified') || undefined
      const data = await response.json()
      const content =
        data.encoding === 'base64'
          ? Buffer.from(data.content as string, 'base64').toString('utf-8')
          : (data.content as string) || ''

      return {
        externalId,
        title: path.split('/').pop() || path,
        content,
        mimeType: 'text/plain',
        sourceUrl: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`,
        contentHash: `${GIT_SHA_PREFIX}${data.sha as string}`,
        metadata: {
          path,
          sha: data.sha as string,
          size: data.size as number,
          branch,
          repository: `${owner}/${repo}`,
          lastModified: lastModifiedHeader,
        },
      }
    } catch (error) {
      logger.warn(`Failed to fetch GitHub document ${externalId}`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const repository = (sourceConfig.repository as string)?.trim()
    if (!repository) {
      return { valid: false, error: 'Repository is required' }
    }

    let owner: string
    let repo: string
    try {
      const parsed = parseRepo(repository)
      owner = parsed.owner
      repo = parsed.repo
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid repository format',
      }
    }

    const maxFiles = sourceConfig.maxFiles as string | undefined
    if (maxFiles && (Number.isNaN(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive number' }
    }

    const branch = ((sourceConfig.branch as string) || 'main').trim()

    try {
      // Verify repo and branch are accessible
      const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 404) {
        return {
          valid: false,
          error: `Repository "${owner}/${repo}" or branch "${branch}" not found`,
        }
      }

      if (!response.ok) {
        return { valid: false, error: `Cannot access repository: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'repository', displayName: 'Repository', fieldType: 'text' },
    { id: 'branch', displayName: 'Branch', fieldType: 'text' },
    { id: 'size', displayName: 'File Size', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.path === 'string') result.path = metadata.path
    if (typeof metadata.repository === 'string') result.repository = metadata.repository
    if (typeof metadata.branch === 'string') result.branch = metadata.branch

    if (metadata.size != null) {
      const num = Number(metadata.size)
      if (!Number.isNaN(num)) result.size = num
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
