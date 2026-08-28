import { z } from 'zod'
import type { ContractBody } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const cloudwatchLogGroupSchema = z.object({ logGroupName: z.string() }).passthrough()
const cloudwatchLogStreamSchema = z.object({ logStreamName: z.string() }).passthrough()
const optionalString = z.string().optional()

const definePostToolContract = <TBody extends z.ZodType, TResponse extends z.ZodType>(
  path: string,
  body: TBody,
  response: TResponse
) =>
  defineRouteContract({
    method: 'POST',
    path,
    body,
    response: { mode: 'json', schema: response },
  })

/**
 * AWS region with format validation. Matches the route-level check via
 * `validateAwsRegion` (e.g. `us-east-1`, `eu-west-2`).
 */
const awsRegionSchema = z
  .string()
  .min(1, 'AWS region is required')
  .refine((value) => validateAwsRegion(value).isValid, {
    message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
  })

/**
 * Optional integer limit that accepts numbers, numeric strings, empty strings,
 * and null. Empty/null/undefined → undefined (no limit).
 */
const optionalLimitSchema = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z.coerce.number().int().positive().optional()
)

export const cloudwatchLogGroupsBodySchema = z.object({
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  region: awsRegionSchema,
  prefix: optionalString,
  limit: optionalLimitSchema.optional(),
})

export const cloudwatchLogStreamsBodySchema = cloudwatchLogGroupsBodySchema.extend({
  logGroupName: z.string().min(1, 'Log group name is required'),
})

export const cloudwatchLogGroupsContract = definePostToolContract(
  '/api/tools/cloudwatch/describe-log-groups',
  cloudwatchLogGroupsBodySchema,
  z
    .object({
      success: z.boolean().optional(),
      output: z.object({ logGroups: z.array(cloudwatchLogGroupSchema) }),
    })
    .passthrough()
)

export const cloudwatchLogStreamsContract = definePostToolContract(
  '/api/tools/cloudwatch/describe-log-streams',
  cloudwatchLogStreamsBodySchema,
  z
    .object({
      success: z.boolean().optional(),
      output: z.object({ logStreams: z.array(cloudwatchLogStreamSchema) }),
    })
    .passthrough()
)

export type CloudwatchLogGroupsBody = ContractBody<typeof cloudwatchLogGroupsContract>
export type CloudwatchLogStreamsBody = ContractBody<typeof cloudwatchLogStreamsContract>
