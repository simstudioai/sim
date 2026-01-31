import type {
  IncidentioSchedulesDeleteParams,
  IncidentioSchedulesDeleteResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const schedulesDeleteTool: ToolConfig<
  IncidentioSchedulesDeleteParams,
  IncidentioSchedulesDeleteResponse
> = {
  id: 'incidentio_schedules_delete',
  name: 'Delete Schedule',
  description: 'Delete a schedule in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the schedule to delete (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/schedules/${params.id}`,
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: {
        message: 'Schedule deleted successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Success message',
    },
  },
}
