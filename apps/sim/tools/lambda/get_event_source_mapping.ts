import type {
  LambdaGetEventSourceMappingParams,
  LambdaGetEventSourceMappingResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getEventSourceMappingTool: InternalToolConfig<
  LambdaGetEventSourceMappingParams,
  LambdaGetEventSourceMappingResponse
> = {
  id: 'lambda_get_event_source_mapping',
  name: 'Lambda Get Event Source Mapping',
  description: 'Get details about an event source mapping',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    uuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the event source mapping',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      uuid: params.uuid,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        eventSourceMapping: data.output.eventSourceMapping,
      },
    }
  },

  outputs: {
    eventSourceMapping: {
      type: 'json',
      description: 'The event source mapping with its UUID, state, batching, and filter settings',
    },
  },
}
