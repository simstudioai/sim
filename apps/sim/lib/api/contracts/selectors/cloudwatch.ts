import { z } from 'zod'
import { definePostSelector, optionalString } from '@/lib/api/contracts/selectors/shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const cloudwatchLogGroupSchema = z.object({ logGroupName: z.string() }).passthrough()
const cloudwatchLogStreamSchema = z.object({ logStreamName: z.string() }).passthrough()
const cloudwatchSelectorLogGroupSchema = z.object({ logGroupName: z.string() }).strict()
const cloudwatchSelectorLogStreamSchema = z.object({ logStreamName: z.string() }).strict()

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

const cloudwatchSelectorBaseBodySchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  region: z.string().min(1, 'AWS region is required'),
  prefix: optionalString,
  limit: optionalLimitSchema.optional(),
})

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

export const cloudwatchSelectorLogGroupsBodySchema = cloudwatchSelectorBaseBodySchema

export const cloudwatchSelectorLogStreamsBodySchema = cloudwatchSelectorBaseBodySchema.extend({
  logGroupName: z.string().min(1, 'Log group name is required'),
})

export const cloudwatchLogGroupsSelectorContract = definePostSelector(
  '/api/tools/cloudwatch/describe-log-groups',
  cloudwatchLogGroupsBodySchema,
  z
    .object({
      success: z.boolean().optional(),
      output: z.object({ logGroups: z.array(cloudwatchLogGroupSchema) }),
    })
    .passthrough()
)

export const cloudwatchLogStreamsSelectorContract = definePostSelector(
  '/api/tools/cloudwatch/describe-log-streams',
  cloudwatchLogStreamsBodySchema,
  z
    .object({
      success: z.boolean().optional(),
      output: z.object({ logStreams: z.array(cloudwatchLogStreamSchema) }),
    })
    .passthrough()
)

export const cloudwatchSelectorLogGroupsContract = definePostSelector(
  '/api/tools/cloudwatch/selector-log-groups',
  cloudwatchSelectorLogGroupsBodySchema,
  z.object({ logGroups: z.array(cloudwatchSelectorLogGroupSchema) }).strict()
)

export const cloudwatchSelectorLogStreamsContract = definePostSelector(
  '/api/tools/cloudwatch/selector-log-streams',
  cloudwatchSelectorLogStreamsBodySchema,
  z.object({ logStreams: z.array(cloudwatchSelectorLogStreamSchema) }).strict()
)

export const cloudwatchSelectorContractsByPath = {
  '/api/tools/cloudwatch/describe-log-groups': cloudwatchLogGroupsSelectorContract,
  '/api/tools/cloudwatch/describe-log-streams': cloudwatchLogStreamsSelectorContract,
  '/api/tools/cloudwatch/selector-log-groups': cloudwatchSelectorLogGroupsContract,
  '/api/tools/cloudwatch/selector-log-streams': cloudwatchSelectorLogStreamsContract,
} as const

export type CloudwatchLogGroupsSelectorResponse = ContractJsonResponse<
  typeof cloudwatchLogGroupsSelectorContract
>
export type CloudwatchLogStreamsSelectorResponse = ContractJsonResponse<
  typeof cloudwatchLogStreamsSelectorContract
>
export type CloudwatchLogGroupsSelectorRequest = ContractBodyInput<
  typeof cloudwatchLogGroupsSelectorContract
>
export type CloudwatchLogGroupsSelectorBody = ContractBody<
  typeof cloudwatchLogGroupsSelectorContract
>
export type CloudwatchLogStreamsSelectorRequest = ContractBodyInput<
  typeof cloudwatchLogStreamsSelectorContract
>
export type CloudwatchLogStreamsSelectorBody = ContractBody<
  typeof cloudwatchLogStreamsSelectorContract
>
