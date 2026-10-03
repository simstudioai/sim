import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const InstanceInformationStringFilterSchema = z.object({
  Key: z.string().min(1, 'Filter Key is required'),
  Values: z.array(z.string().min(1)).min(1).max(100),
})

const InstanceInformationSchema = z.object({
  instanceId: z.string(),
  pingStatus: z.string(),
  lastPingDateTime: z.string().nullable(),
  agentVersion: z.string().nullable(),
  isLatestVersion: z.boolean().nullable(),
  platformType: z.string().nullable(),
  platformName: z.string().nullable(),
  platformVersion: z.string().nullable(),
  activationId: z.string().nullable(),
  iamRole: z.string().nullable(),
  registrationDate: z.string().nullable(),
  resourceType: z.string().nullable(),
  name: z.string().nullable(),
  ipAddress: z.string().nullable(),
  computerName: z.string().nullable(),
  associationStatus: z.string().nullable(),
  lastAssociationExecutionDate: z.string().nullable(),
  lastSuccessfulAssociationExecutionDate: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceType: z.string().nullable(),
})

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  filters: z.array(InstanceInformationStringFilterSchema).nullish(),
  maxResults: z.number().int().min(5).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  instances: z.array(InstanceInformationSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmDescribeInstanceInformationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/describe-instance-information',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmDescribeInstanceInformationRequest = ContractBodyInput<
  typeof awsSsmDescribeInstanceInformationContract
>
export type AwsSsmDescribeInstanceInformationBody = ContractBody<
  typeof awsSsmDescribeInstanceInformationContract
>
export type AwsSsmDescribeInstanceInformationResponse = ContractJsonResponse<
  typeof awsSsmDescribeInstanceInformationContract
>
