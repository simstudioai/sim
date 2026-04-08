import type { DagsterSensorMutationResponse, DagsterStopSensorParams } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface StopSensorResult {
  type: string
  instigationState?: {
    id: string
    status: string
  }
  message?: string
}

const STOP_SENSOR_MUTATION = `
  mutation StopSensor($id: String) {
    stopSensor(id: $id) {
      type: __typename
      ... on StopSensorMutationResult {
        instigationState {
          id
          status
        }
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

export const stopSensorTool: ToolConfig<DagsterStopSensorParams, DagsterSensorMutationResponse> = {
  id: 'dagster_stop_sensor',
  name: 'Dagster Stop Sensor',
  description: 'Disable (stop) a running sensor in Dagster.',
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
        'InstigationState ID of the sensor to stop — available from dagster_list_sensors output',
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
      query: STOP_SENSOR_MUTATION,
      variables: { id: params.instigationStateId },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ stopSensor?: unknown }>(response)

    const result = data.data?.stopSensor as StopSensorResult | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (result.type === 'StopSensorMutationResult' && result.instigationState) {
      return {
        success: true,
        output: {
          id: result.instigationState.id,
          status: result.instigationState.status,
        },
      }
    }

    throw new Error(`${result.type}: ${dagsterUnionErrorMessage(result, 'Stop sensor failed')}`)
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
