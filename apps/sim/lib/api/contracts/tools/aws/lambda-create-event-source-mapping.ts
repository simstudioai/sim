import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaEventSourceMappingSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateEventSourceMappingSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  eventSourceArn: z.string().optional(),
  enabled: z.boolean().optional(),
  batchSize: z.number().int().min(1).max(10000).optional(),
  maximumBatchingWindowInSeconds: z.number().int().min(0).max(300).optional(),
  startingPosition: z.enum(['TRIM_HORIZON', 'LATEST', 'AT_TIMESTAMP']).optional(),
  startingPositionTimestamp: z.iso
    .datetime({ offset: true, message: 'startingPositionTimestamp must be an ISO 8601 datetime' })
    .optional(),
  parallelizationFactor: z.number().int().min(1).max(10).optional(),
  maximumRecordAgeInSeconds: z.number().int().min(-1).max(604800).optional(),
  maximumRetryAttempts: z.number().int().min(-1).max(10000).optional(),
  bisectBatchOnFunctionError: z.boolean().optional(),
  tumblingWindowInSeconds: z.number().int().min(0).max(900).optional(),
  maximumConcurrency: z.number().int().min(2).max(1000).optional(),
  topics: z.array(z.string()).optional(),
  queues: z.array(z.string()).optional(),
  functionResponseTypes: z.array(z.enum(['ReportBatchItemFailures'])).optional(),
  filterPatterns: z.array(z.string()).optional(),
  onSuccessDestination: z.string().optional(),
  onFailureDestination: z.string().optional(),
  kmsKeyArn: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  sourceAccessConfigurations: z
    .array(
      z.object({
        type: z.string().min(1, 'sourceAccessConfigurations[].type is required'),
        uri: z.string().min(1, 'sourceAccessConfigurations[].uri is required'),
      })
    )
    .max(22, 'sourceAccessConfigurations accepts at most 22 entries')
    .optional(),
  documentDbDatabaseName: z.string().optional(),
  documentDbCollectionName: z.string().optional(),
  documentDbFullDocument: z.enum(['UpdateLookup', 'Default']).optional(),
  amazonManagedKafkaConsumerGroupId: z.string().optional(),
  selfManagedKafkaConsumerGroupId: z.string().optional(),
  selfManagedKafkaBootstrapServers: z.array(z.string()).optional(),
})

const CreateEventSourceMappingResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventSourceMapping: lambdaEventSourceMappingSchema,
  }),
})

export const awsLambdaCreateEventSourceMappingContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/create-event-source-mapping',
  body: CreateEventSourceMappingSchema,
  response: { mode: 'json', schema: CreateEventSourceMappingResponseSchema },
})
export type AwsLambdaCreateEventSourceMappingRequest = ContractBodyInput<
  typeof awsLambdaCreateEventSourceMappingContract
>
export type AwsLambdaCreateEventSourceMappingBody = ContractBody<
  typeof awsLambdaCreateEventSourceMappingContract
>
export type AwsLambdaCreateEventSourceMappingResponse = ContractJsonResponse<
  typeof awsLambdaCreateEventSourceMappingContract
>
