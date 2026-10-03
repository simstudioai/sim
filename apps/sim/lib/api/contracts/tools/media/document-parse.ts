import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { AWS_REGION_PATTERN, toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const textractQuerySchema = z.object({
  Text: z.string().min(1),
  Alias: z.string().optional(),
  Pages: z.array(z.string()).optional(),
})

export const textractParseBodySchema = z
  .object({
    accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
    region: z
      .string()
      .min(1, 'AWS region is required')
      .regex(
        AWS_REGION_PATTERN,
        'AWS region must be a valid AWS region (e.g., us-east-1, eu-west-2, us-gov-west-1)'
      ),
    processingMode: z.enum(['sync', 'async']).optional().default('sync'),
    filePath: z.string().optional(),
    file: RawFileInputSchema.optional(),
    s3Uri: z.string().optional(),
    featureTypes: z
      .array(z.enum(['TABLES', 'FORMS', 'QUERIES', 'SIGNATURES', 'LAYOUT']))
      .optional(),
    queries: z.array(textractQuerySchema).optional(),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.processingMode === 'async' && !data.s3Uri) {
      ctx.addIssue({
        code: 'custom',
        message: 'S3 URI is required for multi-page processing (s3://bucket/key)',
        path: ['s3Uri'],
      })
    }
    if (data.processingMode !== 'async' && !data.file && !data.filePath) {
      ctx.addIssue({
        code: 'custom',
        message: 'File input is required for single-page processing',
        path: ['filePath'],
      })
    }
  })

export const textractAnalyzeExpenseBodySchema = z
  .object({
    accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
    region: z
      .string()
      .min(1, 'AWS region is required')
      .regex(
        AWS_REGION_PATTERN,
        'AWS region must be a valid AWS region (e.g., us-east-1, eu-west-2, us-gov-west-1)'
      ),
    processingMode: z.enum(['sync', 'async']).optional().default('sync'),
    filePath: z.string().optional(),
    file: RawFileInputSchema.optional(),
    s3Uri: z.string().optional(),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.processingMode === 'async' && !data.s3Uri) {
      ctx.addIssue({
        code: 'custom',
        message: 'S3 URI is required for multi-page processing (s3://bucket/key)',
        path: ['s3Uri'],
      })
    }
    if (data.processingMode !== 'async' && !data.file && !data.filePath) {
      ctx.addIssue({
        code: 'custom',
        message: 'Document input is required for single-page processing',
        path: ['filePath'],
      })
    }
  })

export const textractAnalyzeIdBodySchema = z
  .object({
    accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
    region: z
      .string()
      .min(1, 'AWS region is required')
      .regex(
        AWS_REGION_PATTERN,
        'AWS region must be a valid AWS region (e.g., us-east-1, eu-west-2, us-gov-west-1)'
      ),
    filePath: z.string().optional(),
    file: RawFileInputSchema.optional(),
    filePathBack: z.string().optional(),
    fileBack: RawFileInputSchema.optional(),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.file && !data.filePath) {
      ctx.addIssue({
        code: 'custom',
        message: 'Identity document is required',
        path: ['filePath'],
      })
    }
  })

export const textractParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/textract/parse',
  body: textractParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const textractAnalyzeExpenseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/textract/analyze-expense',
  body: textractAnalyzeExpenseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const textractAnalyzeIdContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/textract/analyze-id',
  body: textractAnalyzeIdBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
