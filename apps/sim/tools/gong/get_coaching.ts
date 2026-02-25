import type {
  GongCoachingMetricsData,
  GongCoachingRepData,
  GongCoachingUser,
  GongGetCoachingParams,
  GongGetCoachingResponse,
} from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const getCoachingTool: ToolConfig<GongGetCoachingParams, GongGetCoachingResponse> = {
  id: 'gong_get_coaching',
  name: 'Gong Get Coaching',
  description: 'Retrieve coaching metrics for a manager from Gong.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    managerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gong user ID of the manager',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gong workspace ID',
    },
    fromDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in ISO-8601 format',
    },
    toDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in ISO-8601 format',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/coaching')
      url.searchParams.set('manager-id', params.managerId)
      url.searchParams.set('workspace-id', params.workspaceId)
      url.searchParams.set('from', params.fromDate)
      url.searchParams.set('to', params.toDate)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to get coaching metrics')
    }

    const mapUser = (u: Record<string, unknown> | null | undefined): GongCoachingUser | null => {
      if (!u) return null
      return {
        id: (u.id as string) ?? null,
        emailAddress: (u.emailAddress as string) ?? null,
        firstName: (u.firstName as string) ?? null,
        lastName: (u.lastName as string) ?? null,
        title: (u.title as string) ?? null,
      }
    }

    const coachingData: GongCoachingMetricsData[] = (data.coachingData ?? []).map(
      (item: Record<string, unknown>) => {
        const directReportsMetrics: GongCoachingRepData[] = (
          (item.directReportsMetrics as Record<string, unknown>[]) ?? []
        ).map((rep: Record<string, unknown>) => ({
          report: mapUser(rep.report as Record<string, unknown> | null),
          metrics: (rep.metrics as Record<string, string[]>) ?? null,
        }))

        return {
          manager: mapUser(item.manager as Record<string, unknown> | null),
          directReportsMetrics,
        }
      }
    )

    return {
      success: true,
      output: {
        requestId: (data.requestId as string) ?? null,
        coachingData,
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
    },
    coachingData: {
      type: 'array',
      description: "A list of coaching data entries, one per manager's team",
      items: {
        type: 'object',
        properties: {
          manager: {
            type: 'object',
            description: 'The manager user information',
            properties: {
              id: { type: 'string', description: 'Gong unique numeric identifier for the user' },
              emailAddress: { type: 'string', description: 'Email address of the Gong user' },
              firstName: { type: 'string', description: 'First name of the Gong user' },
              lastName: { type: 'string', description: 'Last name of the Gong user' },
              title: { type: 'string', description: 'Job title of the Gong user' },
            },
          },
          directReportsMetrics: {
            type: 'array',
            description: 'Coaching metrics for each direct report',
            items: {
              type: 'object',
              properties: {
                report: {
                  type: 'object',
                  description: 'The direct report user information',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'Gong unique numeric identifier for the user',
                    },
                    emailAddress: {
                      type: 'string',
                      description: 'Email address of the Gong user',
                    },
                    firstName: { type: 'string', description: 'First name of the Gong user' },
                    lastName: { type: 'string', description: 'Last name of the Gong user' },
                    title: { type: 'string', description: 'Job title of the Gong user' },
                  },
                },
                metrics: {
                  type: 'json',
                  description:
                    'A map of metric names to arrays of string values representing coaching metrics',
                },
              },
            },
          },
        },
      },
    },
  },
}
