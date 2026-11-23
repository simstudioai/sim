import type {
  LambdaDeleteEventSourceMappingParams,
  LambdaDeleteEventSourceMappingResponse,
} from '@/tools/lambda/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const deleteEventSourceMappingTool: InternalToolConfig<
  LambdaDeleteEventSourceMappingParams,
  LambdaDeleteEventSourceMappingResponse
> = {
  id: 'lambda_delete_event_source_mapping',
  name: 'Lambda Delete Event Source Mapping',
  description: 'Delete an event source mapping',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
      description: 'The deleted event source mapping, whose state transitions to Deleting',
    },
  },
}
