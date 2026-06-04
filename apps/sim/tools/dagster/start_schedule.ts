import type {
  DagsterScheduleMutationResponse,
  DagsterStartScheduleParams,
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

const START_SCHEDULE_MUTATION = `
  mutation StartSchedule($scheduleSelector: ScheduleSelector!) {
    startSchedule(scheduleSelector: $scheduleSelector) {
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

export const startScheduleTool: ToolConfig<
  DagsterStartScheduleParams,
  DagsterScheduleMutationResponse
> = {
  id: 'dagster_start_schedule',
  name: 'Dagster Start Schedule',
  description: 'Enable (start) a schedule in a Dagster repository.',
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
    repositoryLocationName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository location (code location) name',
    },
    repositoryName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name within the code location',
    },
    scheduleName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the schedule to start',
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
      query: START_SCHEDULE_MUTATION,
      variables: {
        scheduleSelector: {
          repositoryLocationName: params.repositoryLocationName,
          repositoryName: params.repositoryName,
          scheduleName: params.scheduleName,
        },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ startSchedule?: unknown }>(response)

    const result = data.data?.startSchedule as ScheduleMutationResult | undefined
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

    throw new Error(`${result.type}: ${dagsterUnionErrorMessage(result, 'Start schedule failed')}`)
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
