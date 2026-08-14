import type {
  MintlifyGetUpdateStatusParams,
  MintlifyGetUpdateStatusResponse,
  MintlifyUpdateAuthor,
  MintlifyUpdateCommit,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableNumber,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function toAuthor(value: unknown): MintlifyUpdateAuthor | null {
  if (!value || typeof value !== 'object') return null
  const author = value as Record<string, unknown>
  return {
    name: toNullableString(author.name),
    avatarUrl: toNullableString(author.avatarUrl),
    githubUserId: toNullableNumber(author.githubUserId),
  }
}

function toCommit(value: unknown): MintlifyUpdateCommit | null {
  if (!value || typeof value !== 'object') return null
  const commit = value as Record<string, unknown>
  const filesChanged = commit.filesChanged as Record<string, unknown> | undefined

  return {
    sha: toNullableString(commit.sha),
    ref: toNullableString(commit.ref),
    message: toNullableString(commit.message),
    filesChanged: filesChanged
      ? {
          added: toStringList(filesChanged.added),
          modified: toStringList(filesChanged.modified),
          removed: toStringList(filesChanged.removed),
        }
      : null,
  }
}

export const mintlifyGetUpdateStatusTool: ToolConfig<
  MintlifyGetUpdateStatusParams,
  MintlifyGetUpdateStatusResponse
> = {
  id: 'mintlify_get_update_status',
  name: 'Mintlify Get Update Status',
  description:
    'Get the status of a Mintlify deployment update from its status ID, including logs, commit details, and screenshots.',
  version: '1.0.0',

  params: {
    statusId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Status ID returned by Trigger Update or Trigger Preview Deployment',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) =>
      `${MINTLIFY_API_BASE}/v1/project/update-status/${pathSegment(params.statusId)}`,
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify update status')

    return {
      success: true,
      output: {
        id: toNullableString(data._id),
        projectId: toNullableString(data.projectId),
        createdAt: toNullableString(data.createdAt),
        endedAt: toNullableString(data.endedAt),
        status: toNullableString(data.status),
        summary: toNullableString(data.summary),
        logs: toStringList(data.logs),
        subdomain: toNullableString(data.subdomain),
        screenshot: toNullableString(data.screenshot),
        screenshotLight: toNullableString(data.screenshotLight),
        screenshotDark: toNullableString(data.screenshotDark),
        author: toAuthor(data.author),
        commit: toCommit(data.commit),
        source: toNullableString(data.source),
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Status ID of the update', nullable: true },
    projectId: { type: 'string', description: 'Documentation project ID', nullable: true },
    createdAt: { type: 'string', description: 'ISO 8601 UTC start time', nullable: true },
    endedAt: { type: 'string', description: 'ISO 8601 UTC end time', nullable: true },
    status: {
      type: 'string',
      description: 'Update status: queued, in_progress, success, or failure',
      nullable: true,
    },
    summary: { type: 'string', description: 'Summary of the update status', nullable: true },
    logs: { type: 'array', description: 'Deployment log lines' },
    subdomain: {
      type: 'string',
      description: 'Subdomain of the docs being updated',
      nullable: true,
    },
    screenshot: { type: 'string', description: 'Screenshot of the docs', nullable: true },
    screenshotLight: {
      type: 'string',
      description: 'Light-mode screenshot of the docs',
      nullable: true,
    },
    screenshotDark: {
      type: 'string',
      description: 'Dark-mode screenshot of the docs',
      nullable: true,
    },
    author: {
      type: 'object',
      description: 'Author of the update',
      nullable: true,
      properties: {
        name: { type: 'string', description: 'Author name', nullable: true },
        avatarUrl: { type: 'string', description: 'Author avatar image URL', nullable: true },
        githubUserId: { type: 'number', description: 'Author GitHub user ID', nullable: true },
      },
    },
    commit: {
      type: 'object',
      description: 'Commit that produced the update',
      nullable: true,
      properties: {
        sha: { type: 'string', description: 'Commit SHA', nullable: true },
        ref: { type: 'string', description: 'Git ref of the commit', nullable: true },
        message: { type: 'string', description: 'Commit message', nullable: true },
        filesChanged: {
          type: 'object',
          description: 'Files added, modified, and removed by the commit',
          nullable: true,
          properties: {
            added: { type: 'array', description: 'New files added' },
            modified: { type: 'array', description: 'Existing files that were modified' },
            removed: { type: 'array', description: 'Files that were removed' },
          },
        },
      },
    },
    source: {
      type: 'string',
      description:
        'Source of the update trigger: internal, github-app-installation, api, github, dashboard, gitlab, or onboarding',
      nullable: true,
    },
  },
}
