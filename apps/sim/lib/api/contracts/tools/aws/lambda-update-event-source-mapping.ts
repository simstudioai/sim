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

const UpdateEventSourceMappingSchema = z.object({
  ...lambdaConnectionFields,
  uuid: z.string().min(1, 'uuid is required'),
  functionName: z.string().optional(),
  enabled: z.boolean().optional(),
  batchSize: z.number().int().min(1).max(10000).optional(),
  maximumBatchingWindowInSeconds: z.number().int().min(0).max(300).optional(),
  parallelizationFactor: z.number().int().min(1).max(10).optional(),
  maximumRecordAgeInSeconds: z.number().int().min(-1).max(604800).optional(),
  maximumRetryAttempts: z.number().int().min(-1).max(10000).optional(),
  bisectBatchOnFunctionError: z.boolean().optional(),
  tumblingWindowInSeconds: z.number().int().min(0).max(900).optional(),
  maximumConcurrency: z.number().int().min(2).max(1000).optional(),
  functionResponseTypes: z.array(z.enum(['ReportBatchItemFailures'])).optional(),
  filterPatterns: z.array(z.string()).optional(),
  onSuccessDestination: z.string().optional(),
  onFailureDestination: z.string().optional(),
  kmsKeyArn: z.string().optional(),
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
})

const UpdateEventSourceMappingResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventSourceMapping: lambdaEventSourceMappingSchema,
  }),
})

export const awsLambdaUpdateEventSourceMappingContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/update-event-source-mapping',
  body: UpdateEventSourceMappingSchema,
  response: { mode: 'json', schema: UpdateEventSourceMappingResponseSchema },
})
export type AwsLambdaUpdateEventSourceMappingRequest = ContractBodyInput<
  typeof awsLambdaUpdateEventSourceMappingContract
>
export type AwsLambdaUpdateEventSourceMappingBody = ContractBody<
  typeof awsLambdaUpdateEventSourceMappingContract
>
export type AwsLambdaUpdateEventSourceMappingResponse = ContractJsonResponse<
  typeof awsLambdaUpdateEventSourceMappingContract
>
