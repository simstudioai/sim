import type {
  LambdaListEventSourceMappingsParams,
  LambdaListEventSourceMappingsResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const listEventSourceMappingsTool: InternalToolConfig<
  LambdaListEventSourceMappingsParams,
  LambdaListEventSourceMappingsResponse
> = {
  id: 'lambda_list_event_source_mappings',
  name: 'Lambda List Event Source Mappings',
  description: 'List event source mappings, optionally filtered by function or event source',
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
    functionName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only mappings that invoke this function',
    },
    eventSourceArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only mappings for this event source ARN',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token returned by a previous request',
    },
    maxItems: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (1-10000)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.functionName !== undefined && { functionName: params.functionName }),
      ...(params.eventSourceArn !== undefined && { eventSourceArn: params.eventSourceArn }),
      ...(params.marker !== undefined && { marker: params.marker }),
      ...(params.maxItems !== undefined && { maxItems: params.maxItems }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list Lambda event source mappings')
    }

    return {
      success: true,
      output: {
        eventSourceMappings: data.output.eventSourceMappings,
        nextMarker: data.output.nextMarker,
      },
    }
  },

  outputs: {
    eventSourceMappings: {
      type: 'array',
      description: 'Event source mappings with their UUIDs, state, and batching settings',
    },
    nextMarker: {
      type: 'string',
      description: 'Pagination token to pass as marker on the next request',
      nullable: true,
    },
  },
}
