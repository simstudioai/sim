import type {
  DagsterScheduleMutationResponse,
  DagsterStopScheduleParams,
} from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface ScheduleMutationResult {
  type: string
  scheduleState?: {
    id: string
    status: string
  }
  message?: string
}

const STOP_SCHEDULE_MUTATION = `
  mutation StopSchedule($id: String) {
    stopRunningSchedule(id: $id) {
      type: __typename
      ... on ScheduleStateResult {
        scheduleState {
          id
          status
        }
      }
      ... on UnauthorizedError {
        __typename
        message
      }
      ... on ScheduleNotFoundError {
        __typename
        message
      }
      ... on PythonError {
        __typename
        message
      }
    }
  }
`

export const stopScheduleTool: ToolConfig<
  DagsterStopScheduleParams,
  DagsterScheduleMutationResponse
> = {
  id: 'dagster_stop_schedule',
  name: 'Dagster Stop Schedule',
  description: 'Disable (stop) a running schedule in Dagster.',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dagster host URL (e.g., https://myorg.dagster.cloud/prod or http://localhost:3001)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Dagster+ API token (leave blank for OSS / self-hosted)',
    },
    instigationStateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'InstigationState ID of the schedule to stop — available from dagster_list_schedules output',
    },
  },

  request: {
    url: (params) => `${params.host.replace(/\/$/, '')}/graphql`,
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (params.apiKey) headers['Dagster-Cloud-Api-Token'] = params.apiKey
      return headers
    },
    body: (params) => ({
      query: STOP_SCHEDULE_MUTATION,
      variables: { id: params.instigationStateId },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ stopRunningSchedule?: unknown }>(response)

    const result = data.data?.stopRunningSchedule as ScheduleMutationResult | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (result.type === 'ScheduleStateResult' && result.scheduleState) {
      return {
        success: true,
        output: {
          id: result.scheduleState.id,
          status: result.scheduleState.status,
        },
      }
    }

    throw new Error(`${result.type}: ${dagsterUnionErrorMessage(result, 'Stop schedule failed')}`)
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Instigator state ID of the schedule',
    },
    status: {
      type: 'string',
      description: 'Updated schedule status (RUNNING or STOPPED)',
    },
  },
}
