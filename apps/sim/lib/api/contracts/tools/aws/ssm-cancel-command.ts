import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const INSTANCE_ID_PATTERN = /^(i-(\w{8}|\w{17})|mi-\w{17})$/

const COMMAND_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  commandId: z.string().regex(COMMAND_ID_PATTERN, 'commandId must be a 36-character command ID'),
  instanceIds: z
    .array(
      z.string().regex(INSTANCE_ID_PATTERN, 'instanceIds entries must look like i-0abc… or mi-…')
    )
    .max(50)
    .nullish(),
})

const ResponseSchema = z.object({
  message: z.string(),
  commandId: z.string(),
})

export const awsSsmCancelCommandContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/cancel-command',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmCancelCommandRequest = ContractBodyInput<typeof awsSsmCancelCommandContract>
export type AwsSsmCancelCommandBody = ContractBody<typeof awsSsmCancelCommandContract>
export type AwsSsmCancelCommandResponse = ContractJsonResponse<typeof awsSsmCancelCommandContract>
