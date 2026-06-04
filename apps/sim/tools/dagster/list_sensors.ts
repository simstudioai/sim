import type { DagsterListSensorsParams, DagsterListSensorsResponse } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface DagsterSensorGraphql {
  name: string
  sensorType: string | null
  description: string | null
  sensorState?: {
    id: string
    status: string
  } | null
}

function buildListSensorsQuery(hasStatus: boolean) {
  return `
    query ListSensors($repositorySelector: RepositorySelector!${hasStatus ? ', $sensorStatus: InstigationStatus' : ''}) {
      sensorsOrError(repositorySelector: $repositorySelector${hasStatus ? ', sensorStatus: $sensorStatus' : ''}) {
        ... on Sensors {
          results {
            name
            sensorType
            description
            sensorState {
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

export const listSensorsTool: ToolConfig<DagsterListSensorsParams, DagsterListSensorsResponse> = {
  id: 'dagster_list_sensors',
  name: 'Dagster List Sensors',
  description: 'List all sensors in a Dagster repository, optionally filtered by status.',
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
    sensorStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter sensors by status: RUNNING or STOPPED (omit to return all)',
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
      const hasStatus = Boolean(params.sensorStatus)
      const variables: Record<string, unknown> = {
        repositorySelector: {
          repositoryLocationName: params.repositoryLocationName,
          repositoryName: params.repositoryName,
        },
      }
      if (hasStatus) variables.sensorStatus = params.sensorStatus
      return { query: buildListSensorsQuery(hasStatus), variables }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ sensorsOrError?: unknown }>(response)

    const result = data.data?.sensorsOrError as
      | { results?: DagsterSensorGraphql[]; message?: string }
      | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (!Array.isArray(result.results)) {
      throw new Error(dagsterUnionErrorMessage(result, 'List sensors failed'))
    }

    const sensors = result.results.map((s) => ({
      name: s.name,
      sensorType: s.sensorType ?? null,
      status: s.sensorState?.status ?? 'UNKNOWN',
      id: s.sensorState?.id ?? null,
      description: s.description ?? null,
    }))

    return {
      success: true,
      output: { sensors },
    }
  },

  outputs: {
    sensors: {
      type: 'json',
      description: 'Array of sensors (name, sensorType, status, id, description)',
      properties: {
        name: { type: 'string', description: 'Sensor name' },
        sensorType: {
          type: 'string',
          description:
            'Sensor type (ASSET, AUTO_MATERIALIZE, FRESHNESS_POLICY, MULTI_ASSET, RUN_STATUS, STANDARD)',
        },
        status: { type: 'string', description: 'Sensor status: RUNNING or STOPPED' },
        id: {
          type: 'string',
          description: 'Instigator state ID — use this to start or stop the sensor',
        },
        description: { type: 'string', description: 'Human-readable sensor description' },
      },
    },
  },
}
