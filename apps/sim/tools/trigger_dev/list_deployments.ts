import type {
  TriggerDevListDeploymentsParams,
  TriggerDevListDeploymentsResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevDeployment,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_DEPLOYMENT_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevListDeploymentsTool: ToolConfig<
  TriggerDevListDeploymentsParams,
  TriggerDevListDeploymentsResponse
> = {
  id: 'trigger_dev_list_deployments',
  name: 'Trigger.dev List Deployments',
  description:
    'List Trigger.dev deployments in the environment of the API key, with optional status and creation-time filters.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deployment status to filter by: PENDING, BUILDING, DEPLOYING, DEPLOYED, FAILED, CANCELED, or TIMED_OUT',
    },
    period: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return deployments created in the given period (e.g., "1h", "7d")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return deployments created on or after this ISO 8601 timestamp',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return deployments created on or before this ISO 8601 timestamp',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of deployments per page (5 to 100, default 20)',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor to start the page after, from the previous response pagination',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.pageSize) query.set('page[size]', String(params.pageSize))
      if (params.pageAfter) query.set('page[after]', params.pageAfter)
      if (params.status) query.set('status', params.status.toUpperCase())
      if (params.period) query.set('period', params.period)
      if (params.from) query.set('from', params.from)
      if (params.to) query.set('to', params.to)
      const queryString = query.toString()
      return queryString
        ? `${TRIGGER_DEV_API_BASE}/api/v1/deployments?${queryString}`
        : `${TRIGGER_DEV_API_BASE}/api/v1/deployments`
    },
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        deployments: (data.data ?? []).map(mapTriggerDevDeployment),
        pagination: {
          next: data.pagination?.next ?? null,
        },
      },
    }
  },

  outputs: {
    deployments: {
      type: 'array',
      description: 'Deployments matching the filters',
      items: {
        type: 'object',
        description: 'Deployment',
        properties: TRIGGER_DEV_DEPLOYMENT_PROPERTIES,
      },
    },
    pagination: {
      type: 'object',
      description: 'Cursor pagination details',
      properties: {
        next: {
          type: 'string',
          description: 'Cursor to pass as the page-after parameter for the next page',
          nullable: true,
        },
      },
    },
  },
}
