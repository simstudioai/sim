import type {
  LambdaUpdateEventSourceMappingParams,
  LambdaUpdateEventSourceMappingResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const updateEventSourceMappingTool: InternalToolConfig<
  LambdaUpdateEventSourceMappingParams,
  LambdaUpdateEventSourceMappingResponse
> = {
  id: 'lambda_update_event_source_mapping',
  name: 'Lambda Update Event Source Mapping',
  description: 'Update the batching, retry, filtering, or enabled state of an event source mapping',
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
    functionName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Function the mapping should invoke',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the mapping is active',
    },
    batchSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum records sent to the function in a single batch',
    },
    maximumBatchingWindowInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds to gather records before invoking the function (0-300)',
    },
    parallelizationFactor: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of concurrent batches to process from each shard (1-10)',
    },
    maximumRecordAgeInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Discard records older than this. Use -1 for infinite',
    },
    maximumRetryAttempts: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retries before a record is discarded. Use -1 for infinite',
    },
    bisectBatchOnFunctionError: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Split a failing batch in two and retry each half',
    },
    tumblingWindowInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration of a processing window for stream aggregation (0-900)',
    },
    maximumConcurrency: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum concurrent function invocations from an SQS event source (2-1000)',
    },
    functionResponseTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'Set to ReportBatchItemFailures to enable partial batch reporting',
    },
    filterPatterns: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description:
        'Event filter patterns, each a JSON string, that decide which records reach the function',
    },
    onSuccessDestination: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the destination that receives successfully processed records',
    },
    onFailureDestination: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the destination that receives discarded records',
    },
    kmsKeyArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the KMS customer managed key used to encrypt filter criteria',
    },
    sourceAccessConfigurations: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Authentication for an Amazon MQ or self-managed Kafka source, as a JSON array of objects with "type" (e.g. BASIC_AUTH, SASL_SCRAM_512_AUTH, VPC_SUBNET) and "uri" (the Secrets Manager or VPC resource ARN)',
    },
    documentDbDatabaseName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'DocumentDB database to consume the change stream from',
    },
    documentDbCollectionName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'DocumentDB collection to consume. Omit to consume the whole database',
    },
    documentDbFullDocument: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UpdateLookup sends the full document on update, Default sends only the change delta',
    },
    amazonManagedKafkaConsumerGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Consumer group ID to join on an Amazon MSK cluster',
    },
    selfManagedKafkaConsumerGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Consumer group ID to join on a self-managed Kafka cluster',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      uuid: params.uuid,
      ...(params.functionName !== undefined && { functionName: params.functionName }),
      ...(params.enabled !== undefined && { enabled: params.enabled }),
      ...(params.batchSize !== undefined && { batchSize: params.batchSize }),
      ...(params.maximumBatchingWindowInSeconds !== undefined && {
        maximumBatchingWindowInSeconds: params.maximumBatchingWindowInSeconds,
      }),
      ...(params.parallelizationFactor !== undefined && {
        parallelizationFactor: params.parallelizationFactor,
      }),
      ...(params.maximumRecordAgeInSeconds !== undefined && {
        maximumRecordAgeInSeconds: params.maximumRecordAgeInSeconds,
      }),
      ...(params.maximumRetryAttempts !== undefined && {
        maximumRetryAttempts: params.maximumRetryAttempts,
      }),
      ...(params.bisectBatchOnFunctionError !== undefined && {
        bisectBatchOnFunctionError: params.bisectBatchOnFunctionError,
      }),
      ...(params.tumblingWindowInSeconds !== undefined && {
        tumblingWindowInSeconds: params.tumblingWindowInSeconds,
      }),
      ...(params.maximumConcurrency !== undefined && {
        maximumConcurrency: params.maximumConcurrency,
      }),
      ...(params.functionResponseTypes !== undefined && {
        functionResponseTypes: params.functionResponseTypes,
      }),
      ...(params.filterPatterns !== undefined && { filterPatterns: params.filterPatterns }),
      ...(params.onSuccessDestination !== undefined && {
        onSuccessDestination: params.onSuccessDestination,
      }),
      ...(params.onFailureDestination !== undefined && {
        onFailureDestination: params.onFailureDestination,
      }),
      ...(params.kmsKeyArn !== undefined && { kmsKeyArn: params.kmsKeyArn }),
      ...(params.sourceAccessConfigurations !== undefined && {
        sourceAccessConfigurations: params.sourceAccessConfigurations,
      }),
      ...(params.documentDbDatabaseName !== undefined && {
        documentDbDatabaseName: params.documentDbDatabaseName,
      }),
      ...(params.documentDbCollectionName !== undefined && {
        documentDbCollectionName: params.documentDbCollectionName,
      }),
      ...(params.documentDbFullDocument !== undefined && {
        documentDbFullDocument: params.documentDbFullDocument,
      }),
      ...(params.amazonManagedKafkaConsumerGroupId !== undefined && {
        amazonManagedKafkaConsumerGroupId: params.amazonManagedKafkaConsumerGroupId,
      }),
      ...(params.selfManagedKafkaConsumerGroupId !== undefined && {
        selfManagedKafkaConsumerGroupId: params.selfManagedKafkaConsumerGroupId,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update Lambda event source mapping')
    }

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
