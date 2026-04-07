import type { DagsterSensorMutationResponse, DagsterStartSensorParams } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface SensorMutationResult {
  type: string
  sensorState?: {
    id: string
    status: string
  }
  message?: string
}

const START_SENSOR_MUTATION = `
  mutation StartSensor($sensorSelector: SensorSelector!) {
    startSensor(sensorSelector: $sensorSelector) {
      type: __typename
      ... on Sensor {
        sensorState {
          id
          status
        }
      }
      ... on SensorNotFoundError {
        __typename
        message
      }
      ... on UnauthorizedError {
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

export const startSensorTool: ToolConfig<DagsterStartSensorParams, DagsterSensorMutationResponse> =
  {
    id: 'dagster_start_sensor',
    name: 'Dagster Start Sensor',
    description: 'Enable (start) a sensor in a Dagster repository.',
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
      sensorName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the sensor to start',
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
        query: START_SENSOR_MUTATION,
        variables: {
          sensorSelector: {
            repositoryLocationName: params.repositoryLocationName,
            repositoryName: params.repositoryName,
            sensorName: params.sensorName,
          },
        },
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await parseDagsterGraphqlResponse<{ startSensor?: unknown }>(response)

      const result = data.data?.startSensor as SensorMutationResult | undefined
      if (!result) throw new Error('Unexpected response from Dagster')

      if (result.type === 'Sensor' && result.sensorState) {
        return {
          success: true,
          output: {
            id: result.sensorState.id,
            status: result.sensorState.status,
          },
        }
      }

      throw new Error(`${result.type}: ${dagsterUnionErrorMessage(result, 'Start sensor failed')}`)
    },

    outputs: {
      id: {
        type: 'string',
        description: 'Instigator state ID of the sensor',
      },
      status: {
        type: 'string',
        description: 'Updated sensor status (RUNNING or STOPPED)',
      },
    },
  }
