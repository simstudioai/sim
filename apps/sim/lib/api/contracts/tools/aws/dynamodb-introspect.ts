import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const IntrospectSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().optional(),
})

const KeySchemaEntrySchema = z.object({
  attributeName: z.string(),
  keyType: z.enum(['HASH', 'RANGE']),
})

const SecondaryIndexSchema = z.object({
  indexName: z.string(),
  keySchema: z.array(KeySchemaEntrySchema),
  projectionType: z.string(),
  indexStatus: z.string(),
})

const TableDetailsSchema = z.object({
  tableName: z.string(),
  tableStatus: z.string(),
  keySchema: z.array(KeySchemaEntrySchema),
  attributeDefinitions: z.array(
    z.object({
      attributeName: z.string(),
      attributeType: z.enum(['S', 'N', 'B']),
    })
  ),
  globalSecondaryIndexes: z.array(SecondaryIndexSchema),
  localSecondaryIndexes: z.array(SecondaryIndexSchema),
  itemCount: z.number(),
  tableSizeBytes: z.number(),
  billingMode: z.string(),
})

const IntrospectResponseSchema = z.object({
  message: z.string(),
  tables: z.array(z.string()),
  tableDetails: TableDetailsSchema.optional(),
})

export const awsDynamodbIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/dynamodb/introspect',
  body: IntrospectSchema,
  response: { mode: 'json', schema: IntrospectResponseSchema },
})
export type AwsDynamodbIntrospectRequest = ContractBodyInput<typeof awsDynamodbIntrospectContract>
export type AwsDynamodbIntrospectBody = ContractBody<typeof awsDynamodbIntrospectContract>
export type AwsDynamodbIntrospectResponse = ContractJsonResponse<
  typeof awsDynamodbIntrospectContract
>
