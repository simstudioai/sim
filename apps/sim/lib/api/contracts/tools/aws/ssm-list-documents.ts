import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DocumentKeyValuesFilterSchema = z.object({
  Key: z.string().min(1, 'Filter Key must not be empty').max(128).optional(),
  Values: z.array(z.string().min(1).max(256)).optional(),
})

const DocumentIdentifierSchema = z.object({
  name: z.string(),
  displayName: z.string().nullable(),
  owner: z.string().nullable(),
  createdDate: z.string().nullable(),
  versionName: z.string().nullable(),
  documentVersion: z.string().nullable(),
  documentType: z.string().nullable(),
  documentFormat: z.string().nullable(),
  schemaVersion: z.string().nullable(),
  platformTypes: z.array(z.string()),
  targetType: z.string().nullable(),
  reviewStatus: z.string().nullable(),
  author: z.string().nullable(),
  tags: z.array(z.object({ key: z.string(), value: z.string() })),
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
  filters: z.array(DocumentKeyValuesFilterSchema).max(6).nullish(),
  maxResults: z.number().int().min(1).max(50).nullish(),
  nextToken: z.string().nullish(),
})

const ResponseSchema = z.object({
  documents: z.array(DocumentIdentifierSchema),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSsmListDocumentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/list-documents',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmListDocumentsRequest = ContractBodyInput<typeof awsSsmListDocumentsContract>
export type AwsSsmListDocumentsBody = ContractBody<typeof awsSsmListDocumentsContract>
export type AwsSsmListDocumentsResponse = ContractJsonResponse<typeof awsSsmListDocumentsContract>
