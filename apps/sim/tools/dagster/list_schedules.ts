import type {
  DagsterListSchedulesParams,
  DagsterListSchedulesResponse,
} from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface DagsterScheduleGraphql {
  name: string
  cronSchedule: string | null
  pipelineName: string | null
  description: string | null
  executionTimezone: string | null
  scheduleState?: {
    id: string
    status: string
  } | null
}

function buildListSchedulesQuery(hasStatus: boolean) {
  return `
    query ListSchedules($repositorySelector: RepositorySelector!${hasStatus ? ', $scheduleStatus: InstigationStatus' : ''}) {
      schedulesOrError(repositorySelector: $repositorySelector${hasStatus ? ', scheduleStatus: $scheduleStatus' : ''}) {
        ... on Schedules {
          results {
            name
            cronSchedule
            pipelineName
            description
            executionTimezone
            scheduleState {
              id
              status
            }
          }
        }
        ... on RepositoryNotFoundError {
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
}

export const listSchedulesTool: ToolConfig<
  DagsterListSchedulesParams,
  DagsterListSchedulesResponse
> = {
  id: 'dagster_list_schedules',
  name: 'Dagster List Schedules',
  description: 'List all schedules in a Dagster repository, optionally filtered by status.',
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
    scheduleStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter schedules by status: RUNNING or STOPPED (omit to return all)',
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
    body: (params) => {
      const hasStatus = Boolean(params.scheduleStatus)
      const variables: Record<string, unknown> = {
        repositorySelector: {
          repositoryLocationName: params.repositoryLocationName,
          repositoryName: params.repositoryName,
        },
      }
      if (hasStatus) variables.scheduleStatus = params.scheduleStatus
      return { query: buildListSchedulesQuery(hasStatus), variables }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ schedulesOrError?: unknown }>(response)

    const result = data.data?.schedulesOrError as
      | { results?: DagsterScheduleGraphql[]; message?: string }
      | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (!Array.isArray(result.results)) {
      throw new Error(dagsterUnionErrorMessage(result, 'List schedules failed'))
    }

    const schedules = result.results.map((s) => ({
      name: s.name,
      cronSchedule: s.cronSchedule ?? null,
      jobName: s.pipelineName ?? null,
      status: s.scheduleState?.status ?? 'UNKNOWN',
      id: s.scheduleState?.id ?? null,
      description: s.description ?? null,
      executionTimezone: s.executionTimezone ?? null,
    }))

    return {
      success: true,
      output: { schedules },
    }
  },

  outputs: {
    schedules: {
      type: 'json',
      description:
        'Array of schedules (name, cronSchedule, jobName, status, id, description, executionTimezone)',
      properties: {
        name: { type: 'string', description: 'Schedule name' },
        cronSchedule: { type: 'string', description: 'Cron expression for the schedule' },
        jobName: { type: 'string', description: 'Job the schedule targets' },
        status: { type: 'string', description: 'Schedule status: RUNNING or STOPPED' },
        id: {
          type: 'string',
          description: 'Instigator state ID — use this to start or stop the schedule',
        },
        description: { type: 'string', description: 'Human-readable schedule description' },
        executionTimezone: { type: 'string', description: 'Timezone for cron evaluation' },
      },
    },
  },
}
