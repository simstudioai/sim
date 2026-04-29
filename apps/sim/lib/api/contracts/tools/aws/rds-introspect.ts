import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const IntrospectSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
  schema: z.string().optional(),
  engine: z.enum(['aurora-postgresql', 'aurora-mysql']).optional(),
})

export const awsRdsIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/introspect',
  body: IntrospectSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsRdsIntrospectRequest = ContractBodyInput<typeof awsRdsIntrospectContract>
export type AwsRdsIntrospectBody = ContractBody<typeof awsRdsIntrospectContract>
export type AwsRdsIntrospectResponse = ContractJsonResponse<typeof awsRdsIntrospectContract>
