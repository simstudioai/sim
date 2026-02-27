import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetUsageParams, XGetUsageResponse } from '@/tools/x/types'

const logger = createLogger('XGetUsageTool')

export const xGetUsageTool: ToolConfig<XGetUsageParams, XGetUsageResponse> = {
  id: 'x_get_usage',
  name: 'X Get Usage',
  description: 'Get the API usage data for your X project',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'X OAuth access token',
    },
    days: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days of usage data to return (1-90, default 7)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams({
        'usage.fields':
          'cap_reset_day,daily_client_app_usage,daily_project_usage,project_cap,project_id,project_usage',
      })

      if (params.days) {
        queryParams.append('days', Number(params.days).toString())
      }

      return `https://api.x.com/2/usage/tweets?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Get Usage API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'Failed to get usage data',
        output: {
          capResetDay: null,
          projectId: '',
          projectCap: null,
          projectUsage: null,
          dailyProjectUsage: [],
          dailyClientAppUsage: [],
        },
      }
    }

    return {
      success: true,
      output: {
        capResetDay: data.data.cap_reset_day ?? null,
        projectId: String(data.data.project_id ?? ''),
        projectCap: data.data.project_cap ?? null,
        projectUsage: data.data.project_usage ?? null,
        dailyProjectUsage: (data.data.daily_project_usage?.usage ?? []).map(
          (u: { date: string; usage: number }) => ({
            date: u.date,
            usage: u.usage ?? 0,
          })
        ),
        dailyClientAppUsage: (data.data.daily_client_app_usage ?? []).map(
          (app: { client_app_id: string; usage: { date: string; usage: number }[] }) => ({
            clientAppId: String(app.client_app_id ?? ''),
            usage: (app.usage ?? []).map((u: { date: string; usage: number }) => ({
              date: u.date,
              usage: u.usage ?? 0,
            })),
          })
        ),
      },
    }
  },

  outputs: {
    capResetDay: {
      type: 'number',
      description: 'Day of month when usage cap resets',
      optional: true,
    },
    projectId: {
      type: 'string',
      description: 'The project ID',
    },
    projectCap: {
      type: 'number',
      description: 'The project tweet consumption cap',
      optional: true,
    },
    projectUsage: {
      type: 'number',
      description: 'Total tweets consumed in current period',
      optional: true,
    },
    dailyProjectUsage: {
      type: 'array',
      description: 'Daily project usage breakdown',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Usage date in ISO 8601 format' },
          usage: { type: 'number', description: 'Number of tweets consumed' },
        },
      },
    },
    dailyClientAppUsage: {
      type: 'array',
      description: 'Daily per-app usage breakdown',
      items: {
        type: 'object',
        properties: {
          clientAppId: { type: 'string', description: 'Client application ID' },
          usage: {
            type: 'array',
            description: 'Daily usage entries for this app',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Usage date in ISO 8601 format' },
                usage: { type: 'number', description: 'Number of tweets consumed' },
              },
            },
          },
        },
      },
    },
  },
}
