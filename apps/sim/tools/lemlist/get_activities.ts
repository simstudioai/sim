import type {
  LemlistGetActivitiesParams,
  LemlistGetActivitiesResponse,
} from '@/tools/lemlist/types'
import type { ToolConfig } from '@/tools/types'

export const getActivitiesTool: ToolConfig<
  LemlistGetActivitiesParams,
  LemlistGetActivitiesResponse
> = {
  id: 'lemlist_get_activities',
  name: 'Lemlist Get Activities',
  description:
    'Retrieves campaign activities and steps performed, including email opens, clicks, replies, and other events.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Lemlist API key',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by activity type (e.g., emailOpened, emailClicked, emailReplied, paused)',
    },
    campaignId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by campaign ID (e.g., "cam_abc123def456")',
    },
    leadId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by lead ID (e.g., "lea_abc123def456")',
    },
    isFirst: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter for first activity only',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per request (e.g., 50). Max 100, default 100',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records to skip for pagination (e.g., 0, 100, 200)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.lemlist.com/api/activities')
      url.searchParams.append('version', 'v2')

      if (params.type) url.searchParams.append('type', params.type)
      if (params.campaignId) url.searchParams.append('campaignId', params.campaignId)
      if (params.leadId) url.searchParams.append('leadId', params.leadId)
      if (params.isFirst !== undefined) url.searchParams.append('isFirst', String(params.isFirst))
      if (params.limit !== undefined) url.searchParams.append('limit', String(params.limit))
      if (params.offset !== undefined) url.searchParams.append('offset', String(params.offset))

      return url.toString()
    },
    method: 'GET',
    headers: (params) => {
      const credentials = Buffer.from(`:${params.apiKey}`).toString('base64')
      return {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const activities = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        activities: activities.map((activity: Record<string, unknown>) => ({
          _id: (activity._id as string) ?? '',
          type: (activity.type as string) ?? '',
          leadId: (activity.leadId as string) ?? '',
          campaignId: (activity.campaignId as string) ?? '',
          sequenceId: (activity.sequenceId as string) ?? null,
          stepId: (activity.stepId as string) ?? null,
          createdAt: (activity.createdAt as string) ?? '',
        })),
        count: activities.length,
      },
    }
  },

  outputs: {
    activities: {
      type: 'array',
      description: 'List of activities',
      items: {
        type: 'object',
        properties: {
          _id: { type: 'string', description: 'Activity ID' },
          type: { type: 'string', description: 'Activity type' },
          leadId: { type: 'string', description: 'Associated lead ID' },
          campaignId: { type: 'string', description: 'Campaign ID' },
          sequenceId: { type: 'string', description: 'Sequence ID', optional: true },
          stepId: { type: 'string', description: 'Step ID', optional: true },
          createdAt: { type: 'string', description: 'When the activity occurred' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of activities returned',
    },
  },
}
