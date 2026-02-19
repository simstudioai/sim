import type { ToolConfig } from '@/tools/types'
import type { VercelCheckResponse, VercelGetCheckParams } from '@/tools/vercel/types'

export const vercelGetCheckTool: ToolConfig<VercelGetCheckParams, VercelCheckResponse> = {
  id: 'vercel_get_check',
  name: 'Vercel Get Check',
  description: 'Get details of a specific deployment check',
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
      description: 'Deployment ID the check belongs to',
    },
    checkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Check ID to retrieve',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetCheckParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/deployments/${params.deploymentId.trim()}/checks/${params.checkId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetCheckParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        status: data.status ?? 'registered',
        conclusion: data.conclusion ?? null,
        blocking: data.blocking ?? false,
        deploymentId: data.deploymentId,
        integrationId: data.integrationId ?? null,
        externalId: data.externalId ?? null,
        detailsUrl: data.detailsUrl ?? null,
        path: data.path ?? null,
        rerequestable: data.rerequestable ?? false,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Check ID' },
    name: { type: 'string', description: 'Check name' },
    status: { type: 'string', description: 'Check status: registered, running, or completed' },
    conclusion: {
      type: 'string',
      description: 'Check conclusion: canceled, failed, neutral, succeeded, skipped, or stale',
      optional: true,
    },
    blocking: { type: 'boolean', description: 'Whether the check blocks the deployment' },
    deploymentId: { type: 'string', description: 'Associated deployment ID' },
    integrationId: { type: 'string', description: 'Associated integration ID', optional: true },
    externalId: { type: 'string', description: 'External identifier', optional: true },
    detailsUrl: { type: 'string', description: 'URL with details about the check', optional: true },
    path: { type: 'string', description: 'Page path being checked', optional: true },
    rerequestable: { type: 'boolean', description: 'Whether the check can be rerequested' },
    createdAt: { type: 'number', description: 'Creation timestamp in milliseconds' },
    updatedAt: { type: 'number', description: 'Last update timestamp in milliseconds' },
    startedAt: { type: 'number', description: 'Start timestamp in milliseconds', optional: true },
    completedAt: {
      type: 'number',
      description: 'Completion timestamp in milliseconds',
      optional: true,
    },
  },
}
