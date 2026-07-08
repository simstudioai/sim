import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DescribeSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
})

const RotationRulesResponseSchema = z.object({
  automaticallyAfterDays: z.number().nullable(),
  duration: z.string().nullable(),
  scheduleExpression: z.string().nullable(),
})

const ReplicationStatusResponseSchema = z.object({
  region: z.string(),
  kmsKeyId: z.string().nullable(),
  status: z.string().nullable(),
  statusMessage: z.string().nullable(),
  lastAccessedDate: z.string().nullable(),
})

const DescribeSecretResponseSchema = z.object({
  name: z.string(),
  arn: z.string(),
  description: z.string().nullable(),
  kmsKeyId: z.string().nullable(),
  rotationEnabled: z.boolean(),
  rotationLambdaARN: z.string().nullable(),
  rotationRules: RotationRulesResponseSchema.nullable(),
  lastRotatedDate: z.string().nullable(),
  lastChangedDate: z.string().nullable(),
  lastAccessedDate: z.string().nullable(),
  deletedDate: z.string().nullable(),
  nextRotationDate: z.string().nullable(),
  tags: z.array(z.object({ key: z.string(), value: z.string() })),
  versionIdsToStages: z.record(z.string(), z.array(z.string())).nullable(),
  owningService: z.string().nullable(),
  createdDate: z.string().nullable(),
  primaryRegion: z.string().nullable(),
  replicationStatus: z.array(ReplicationStatusResponseSchema),
})

export const awsSecretsManagerDescribeSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/secrets_manager/describe-secret',
  body: DescribeSecretSchema,
  response: { mode: 'json', schema: DescribeSecretResponseSchema },
})
export type AwsSecretsManagerDescribeSecretRequest = ContractBodyInput<
  typeof awsSecretsManagerDescribeSecretContract
>
export type AwsSecretsManagerDescribeSecretBody = ContractBody<
  typeof awsSecretsManagerDescribeSecretContract
>
export type AwsSecretsManagerDescribeSecretResponse = ContractJsonResponse<
  typeof awsSecretsManagerDescribeSecretContract
>
