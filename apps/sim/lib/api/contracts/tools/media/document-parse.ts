import { z } from 'zod'
import { AWS_REGION_PATTERN, toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

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

export const reductoParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.array(z.number()).optional(),
  tableOutputFormat: z.enum(['html', 'md']).optional(),
})

export const pulseParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.string().optional(),
  extractFigure: z.boolean().optional(),
  figureDescription: z.boolean().optional(),
  returnHtml: z.boolean().optional(),
  chunking: z.string().optional(),
  chunkSize: z.number().optional(),
})

export const extendParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  outputFormat: z.enum(['markdown', 'spatial']).optional(),
  chunking: z.enum(['page', 'document', 'section']).optional(),
  engine: z.enum(['parse_performance', 'parse_light']).optional(),
})

export const mistralParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required').optional(),
  fileData: FileInputSchema.optional(),
  file: FileInputSchema.optional(),
  resultType: z.string().optional(),
  pages: z.array(z.number()).optional(),
  includeImageBase64: z.boolean().optional(),
  imageLimit: z.number().optional(),
  imageMinSize: z.number().optional(),
})

export const textractParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/textract/parse',
  body: textractParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const reductoParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/reducto/parse',
  body: reductoParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const pulseParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/pulse/parse',
  body: pulseParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const extendParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/extend/parse',
  body: extendParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const mistralParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mistral/parse',
  body: mistralParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
