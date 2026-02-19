import type { ToolConfig } from '@/tools/types'
import type {
  VercelGetDeploymentEventsParams,
  VercelGetDeploymentEventsResponse,
} from '@/tools/vercel/types'

export const vercelGetDeploymentEventsTool: ToolConfig<
  VercelGetDeploymentEventsParams,
  VercelGetDeploymentEventsResponse
> = {
  id: 'vercel_get_deployment_events',
  name: 'Vercel Get Deployment Events',
  description: 'Get build and runtime events for a Vercel deployment',
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
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order of events by timestamp: backward or forward (default: forward)',
    },
    follow: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'When set to 1, returns live events as they happen',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return (-1 for all)',
    },
    since: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp to start pulling build logs from',
    },
    until: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp to stop pulling build logs at',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetDeploymentEventsParams) => {
      const query = new URLSearchParams()
      if (params.direction) query.set('direction', params.direction)
      if (params.follow !== undefined) query.set('follow', String(params.follow))
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.since !== undefined) query.set('since', String(params.since))
      if (params.until !== undefined) query.set('until', String(params.until))
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v3/deployments/${params.deploymentId.trim()}/events${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetDeploymentEventsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const events = (Array.isArray(data) ? data : (data.events ?? [])).map((e: any) => ({
      type: e.type ?? null,
      created: e.created ?? null,
      date: e.date ?? null,
      text: e.text ?? e.payload?.text ?? null,
      serial: e.serial ?? null,
      deploymentId: e.deploymentId ?? e.payload?.deploymentId ?? null,
      id: e.id ?? null,
      level: e.level ?? null,
    }))

    return {
      success: true,
      output: {
        events,
        count: events.length,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of deployment events',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description:
              'Event type: delimiter, command, stdout, stderr, exit, deployment-state, middleware, middleware-invocation, edge-function-invocation, metric, report, fatal',
          },
          created: { type: 'number', description: 'Event creation timestamp' },
          date: { type: 'number', description: 'Event date timestamp' },
          text: { type: 'string', description: 'Event text content' },
          serial: { type: 'string', description: 'Event serial identifier' },
          deploymentId: { type: 'string', description: 'Associated deployment ID' },
          id: { type: 'string', description: 'Event unique identifier' },
          level: { type: 'string', description: 'Event level: error or warning' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of events returned',
    },
  },
}
