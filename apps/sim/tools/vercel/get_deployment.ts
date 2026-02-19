import type { ToolConfig } from '@/tools/types'
import type { VercelGetDeploymentParams, VercelGetDeploymentResponse } from '@/tools/vercel/types'

export const vercelGetDeploymentTool: ToolConfig<
  VercelGetDeploymentParams,
  VercelGetDeploymentResponse
> = {
  id: 'vercel_get_deployment',
  name: 'Vercel Get Deployment',
  description: 'Get details of a specific Vercel deployment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique deployment identifier or hostname',
    },
    withGitRepoInfo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to add in gitRepo information (true/false)',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetDeploymentParams) => {
      const query = new URLSearchParams()
      if (params.withGitRepoInfo) query.set('withGitRepoInfo', params.withGitRepoInfo)
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v13/deployments/${params.deploymentId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetDeploymentParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        url: data.url ?? '',
        readyState: data.readyState ?? 'UNKNOWN',
        status: data.status ?? data.readyState ?? 'UNKNOWN',
        target: data.target ?? null,
        createdAt: data.createdAt ?? data.created,
        buildingAt: data.buildingAt ?? null,
        ready: data.ready ?? null,
        source: data.source ?? '',
        alias: data.alias ?? [],
        regions: data.regions ?? [],
        inspectorUrl: data.inspectorUrl ?? '',
        projectId: data.projectId ?? '',
        creator: {
          uid: data.creator?.uid ?? '',
          username: data.creator?.username ?? '',
        },
        project: data.project
          ? {
              id: data.project.id,
              name: data.project.name,
              framework: data.project.framework ?? null,
            }
          : null,
        meta: data.meta ?? {},
        gitSource: data.gitSource ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deployment ID' },
    name: { type: 'string', description: 'Deployment name' },
    url: { type: 'string', description: 'Unique deployment URL' },
    readyState: {
      type: 'string',
      description: 'Deployment ready state: QUEUED, BUILDING, ERROR, INITIALIZING, READY, CANCELED',
    },
    status: {
      type: 'string',
      description: 'Deployment status',
    },
    target: { type: 'string', description: 'Target environment', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp in milliseconds' },
    buildingAt: { type: 'number', description: 'Build start timestamp', optional: true },
    ready: { type: 'number', description: 'Ready timestamp', optional: true },
    source: {
      type: 'string',
      description: 'Deployment source: cli, git, redeploy, import, v0-web, etc.',
    },
    alias: {
      type: 'array',
      description: 'Assigned aliases',
      items: { type: 'string', description: 'Alias domain' },
    },
    regions: {
      type: 'array',
      description: 'Deployment regions',
      items: { type: 'string', description: 'Region code' },
    },
    inspectorUrl: { type: 'string', description: 'Vercel inspector URL' },
    projectId: { type: 'string', description: 'Associated project ID' },
    creator: {
      type: 'object',
      description: 'Creator information',
      properties: {
        uid: { type: 'string', description: 'Creator user ID' },
        username: { type: 'string', description: 'Creator username' },
      },
    },
    project: {
      type: 'object',
      description: 'Associated project',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Project ID' },
        name: { type: 'string', description: 'Project name' },
        framework: { type: 'string', description: 'Project framework', optional: true },
      },
    },
    meta: {
      type: 'object',
      description: 'Deployment metadata (key-value strings)',
      properties: {
        githubCommitSha: { type: 'string', description: 'GitHub commit SHA', optional: true },
        githubCommitMessage: {
          type: 'string',
          description: 'GitHub commit message',
          optional: true,
        },
        githubCommitRef: { type: 'string', description: 'GitHub branch/ref', optional: true },
        githubRepo: { type: 'string', description: 'GitHub repository', optional: true },
        githubOrg: { type: 'string', description: 'GitHub organization', optional: true },
        githubCommitAuthorName: {
          type: 'string',
          description: 'Commit author name',
          optional: true,
        },
      },
    },
    gitSource: {
      type: 'object',
      description: 'Git source information',
      optional: true,
      properties: {
        type: {
          type: 'string',
          description: 'Git provider type (e.g., github, gitlab, bitbucket)',
        },
        ref: { type: 'string', description: 'Git ref (branch or tag)' },
        sha: { type: 'string', description: 'Git commit SHA' },
        repoId: { type: 'string', description: 'Repository ID', optional: true },
      },
    },
  },
}
