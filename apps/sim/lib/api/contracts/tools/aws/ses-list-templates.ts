import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListTemplatesSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  pageSize: z.number().int().min(1).max(100).nullish(),
  nextToken: z.string().nullish(),
})

const ListTemplatesResponseSchema = z.object({
  templates: z.array(
    z.object({
      templateName: z.string(),
      createdTimestamp: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSesListTemplatesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ses/list-templates',
  body: ListTemplatesSchema,
  response: { mode: 'json', schema: ListTemplatesResponseSchema },
})
export type AwsSesListTemplatesRequest = ContractBodyInput<typeof awsSesListTemplatesContract>
export type AwsSesListTemplatesBody = ContractBody<typeof awsSesListTemplatesContract>
export type AwsSesListTemplatesResponse = ContractJsonResponse<typeof awsSesListTemplatesContract>
