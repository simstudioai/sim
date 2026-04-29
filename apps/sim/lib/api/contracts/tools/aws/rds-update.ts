import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
  table: z.string().min(1, 'Table name is required'),
  data: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Data object must have at least one field',
  }),
  conditions: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one condition is required',
  }),
})

export const awsRdsUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/rds/update',
  body: UpdateSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsRdsUpdateRequest = ContractBodyInput<typeof awsRdsUpdateContract>
export type AwsRdsUpdateBody = ContractBody<typeof awsRdsUpdateContract>
export type AwsRdsUpdateResponse = ContractJsonResponse<typeof awsRdsUpdateContract>
