import type { ToolConfig } from '@/tools/types'
import type { VercelListChecksParams, VercelListChecksResponse } from '@/tools/vercel/types'

export const vercelListChecksTool: ToolConfig<VercelListChecksParams, VercelListChecksResponse> = {
  id: 'vercel_list_checks',
  name: 'Vercel List Checks',
  description: 'List all checks for a deployment',
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
      description: 'Deployment ID to list checks for',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelListChecksParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/deployments/${params.deploymentId.trim()}/checks${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListChecksParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const checks = (data.checks ?? []).map((check: Record<string, unknown>) => ({
      id: check.id,
      name: check.name,
      status: check.status ?? 'registered',
      conclusion: check.conclusion ?? null,
      blocking: check.blocking ?? false,
      deploymentId: check.deploymentId,
      integrationId: check.integrationId ?? null,
      externalId: check.externalId ?? null,
      detailsUrl: check.detailsUrl ?? null,
      path: check.path ?? null,
      rerequestable: check.rerequestable ?? false,
      createdAt: check.createdAt,
      updatedAt: check.updatedAt,
      startedAt: check.startedAt ?? null,
      completedAt: check.completedAt ?? null,
    }))
    return {
      success: true,
      output: {
        checks,
        count: checks.length,
      },
    }
  },

  outputs: {
    checks: {
      type: 'array',
      description: 'List of deployment checks',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Check ID' },
          name: { type: 'string', description: 'Check name' },
          status: { type: 'string', description: 'Check status' },
          conclusion: { type: 'string', description: 'Check conclusion' },
          blocking: { type: 'boolean', description: 'Whether the check blocks the deployment' },
          deploymentId: { type: 'string', description: 'Associated deployment ID' },
          integrationId: { type: 'string', description: 'Associated integration ID' },
          externalId: { type: 'string', description: 'External identifier' },
          detailsUrl: { type: 'string', description: 'URL with details about the check' },
          path: { type: 'string', description: 'Page path being checked' },
          rerequestable: { type: 'boolean', description: 'Whether the check can be rerequested' },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
          startedAt: { type: 'number', description: 'Start timestamp' },
          completedAt: { type: 'number', description: 'Completion timestamp' },
        },
      },
    },
    count: { type: 'number', description: 'Total number of checks' },
  },
}
