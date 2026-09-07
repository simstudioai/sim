import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DOCUMENT_NAME_PATTERN = /^[a-zA-Z0-9_\-.:/]{3,128}$/

const DOCUMENT_VERSION_PATTERN = /^(\$LATEST|\$DEFAULT|[1-9][0-9]*)$/

const RequestSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: z
    .string()
    .regex(DOCUMENT_NAME_PATTERN, 'name must be 3-128 characters of letters, digits, and _-.:/'),
  documentVersion: z
    .string()
    .regex(
      DOCUMENT_VERSION_PATTERN,
      'documentVersion must be $LATEST, $DEFAULT, or a positive version number'
    )
    .nullish(),
  versionName: z
    .string()
    .regex(
      /^[a-zA-Z0-9_\-.]{1,128}$/,
      'versionName must be 1-128 characters of letters, digits, and _-.'
    )
    .nullish(),
  documentFormat: z.enum(['YAML', 'JSON', 'TEXT']).nullish(),
})

const ResponseSchema = z.object({
  name: z.string(),
  displayName: z.string().nullable(),
  createdDate: z.string().nullable(),
  versionName: z.string().nullable(),
  documentVersion: z.string().nullable(),
  status: z.string().nullable(),
  statusInformation: z.string().nullable(),
  content: z.string(),
  documentType: z.string().nullable(),
  documentFormat: z.string().nullable(),
  reviewStatus: z.string().nullable(),
})

export const awsSsmGetDocumentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/ssm/get-document',
  body: RequestSchema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsSsmGetDocumentRequest = ContractBodyInput<typeof awsSsmGetDocumentContract>
export type AwsSsmGetDocumentBody = ContractBody<typeof awsSsmGetDocumentContract>
export type AwsSsmGetDocumentResponse = ContractJsonResponse<typeof awsSsmGetDocumentContract>
