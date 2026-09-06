import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

export const DOCUMENT_INLINE_BYTES = 8_000_000
export const DOCUMENT_JSON_BYTES = 32 * 1024 * 1024
export const DOCUMENT_OPERATIONS = [
  'analyze_document',
  'create_processor_job',
  'get_processor_job',
  'cancel_processor_job',
  'list_job_outputs',
  'get_job_output',
  'list_projects',
  'list_models',
  'get_model',
  'get_model_type',
] as const

const id = z.string().trim().min(1).max(1024)
const exactName = z
  .string()
  .min(1)
  .max(1024)
  .refine((s) => !/[\u0000-\u001f]/.test(s), 'Control characters are not supported')
const pageRange = z
  .array(
    z
      .string()
      .regex(/^[1-9]\d*(?:-[1-9]\d*)?$/)
      .max(20)
  )
  .min(1)
  .max(100)
  .refine(
    (ranges) =>
      ranges.every((range) => {
        const [start, end = start] = range.split('-').map(Number)
        return start <= end && end <= 2000
      }),
    'Page ranges must be ascending and within 1–2000'
  )

export const documentObjectSchema = z
  .object({
    namespaceName: id,
    bucketName: id,
    objectName: exactName,
    pageRange: pageRange.optional(),
  })
  .strict()
export const documentOutputSchema = z
  .object({ namespaceName: id, bucketName: id, prefix: z.string().max(1024) })
  .strict()
const model = { modelId: id.optional() }
const feature = z.discriminatedUnion('featureType', [
  z
    .object({
      featureType: z.literal('TEXT_EXTRACTION'),
      ...model,
      generateSearchablePdf: z.boolean().optional(),
      selectionMarkDetection: z.boolean().optional(),
    })
    .strict(),
  z.object({ featureType: z.literal('TABLE_EXTRACTION'), ...model }).strict(),
  z
    .object({ featureType: z.literal('KEY_VALUE_EXTRACTION'), ...model, tenancyId: id.optional() })
    .strict(),
  z
    .object({
      featureType: z.literal('DOCUMENT_CLASSIFICATION'),
      ...model,
      tenancyId: id.optional(),
      maxResults: z.number().int().positive().max(100).optional(),
    })
    .strict(),
  z
    .object({
      featureType: z.literal('LANGUAGE_CLASSIFICATION'),
      maxResults: z.number().int().positive().max(100).optional(),
    })
    .strict(),
])

const file = z
  .object({
    id: id,
    name: exactName,
    key: exactName,
    url: z.string().max(4096),
    size: z.number().finite().nonnegative(),
    type: z.string().max(256),
    context: z.string().max(64).optional(),
    base64: z.never().optional(),
    providerFileId: z.never().optional(),
    providerFileUri: z.never().optional(),
  })
  .strip()

const projection = {
  pageNumbers: z.array(z.number().int().min(1).max(2000)).min(1).max(100).optional(),
  maxPages: z.number().int().min(1).max(100).default(20),
  maxOutputBytes: z
    .number()
    .int()
    .min(16384)
    .max(8 * 1024 * 1024)
    .default(1024 * 1024),
  includeWords: z.boolean().default(false),
  includeGeometry: z.boolean().default(false),
}
const auth = { credentialId: id, region: z.string().trim().min(1).max(64).optional() }
const analysis = {
  source: z.enum(['file', 'objectStorage']),
  file: file.optional(),
  objects: z.array(documentObjectSchema).min(1).max(2000).optional(),
  pageRange: pageRange.optional(),
  features: z
    .array(feature)
    .min(1)
    .max(5)
    .refine(
      (v) => new Set(v.map((f) => f.featureType)).size === v.length,
      'Features must be unique'
    ),
  documentType: z
    .enum([
      'INVOICE',
      'RECEIPT',
      'RESUME',
      'TAX_FORM',
      'DRIVER_LICENSE',
      'PASSPORT',
      'BANK_STATEMENT',
      'CHECK',
      'PAYSLIP',
      'HEALTH_INSURANCE_ID',
      'OTHERS',
    ])
    .optional(),
  language: z
    .string()
    .trim()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/)
    .optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
}
const lists = {
  compartmentId: id,
  displayName: z.string().trim().min(1).max(255).optional(),
  lifecycleState: id.optional(),
  limit: z.number().int().min(1).max(100).default(100),
  page: z.string().max(4096).optional(),
}

export const documentInputSchema = z
  .discriminatedUnion('operation', [
    z
      .object({
        ...auth,
        ...analysis,
        ...projection,
        operation: z.literal('analyze_document'),
        compartmentId: id.optional(),
      })
      .strict(),
    z
      .object({
        ...auth,
        ...analysis,
        operation: z.literal('create_processor_job'),
        compartmentId: id,
        outputLocation: documentOutputSchema,
        displayName: z.string().trim().min(1).max(255).optional(),
        retryToken: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/)
          .optional(),
      })
      .strict(),
    z.object({ ...auth, operation: z.literal('get_processor_job'), jobId: id }).strict(),
    z
      .object({
        ...auth,
        operation: z.literal('cancel_processor_job'),
        jobId: id,
        ifMatch: z.string().min(1).max(1024).optional(),
      })
      .strict(),
    z
      .object({
        ...auth,
        operation: z.literal('list_job_outputs'),
        jobId: id,
        limit: z.number().int().min(1).max(1000).default(100),
        start: z.string().max(4096).optional(),
      })
      .strict(),
    z
      .object({
        ...auth,
        ...projection,
        operation: z.literal('get_job_output'),
        jobId: id,
        objectName: exactName,
        resultType: z.enum(['structured', 'file']).default('structured'),
        ifMatch: z.string().min(1).max(1024).optional(),
      })
      .strict(),
    z.object({ ...auth, ...lists, operation: z.literal('list_projects') }).strict(),
    z
      .object({ ...auth, ...lists, operation: z.literal('list_models'), projectId: id.optional() })
      .strict(),
    z.object({ ...auth, operation: z.literal('get_model'), modelId: id }).strict(),
    z
      .object({
        ...auth,
        operation: z.literal('get_model_type'),
        modelType: id,
        compartmentId: id.optional(),
        modelSubType: id.optional(),
      })
      .strict(),
  ])
  .superRefine((input, ctx) => {
    if (input.operation !== 'analyze_document' && input.operation !== 'create_processor_job') return
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    if (
      input.source === 'file'
        ? !input.file || input.objects !== undefined
        : !input.objects || input.file !== undefined || input.pageRange !== undefined
    ) {
      issue('Choose exactly one source: a stored Sim file or Oracle object references')
    }
    if (input.operation === 'analyze_document' && input.objects && input.objects.length !== 1) {
      issue('Synchronous analysis requires exactly one object')
    }
    if (
      input.operation === 'analyze_document' &&
      input.features.some((f) => f.featureType === 'TEXT_EXTRACTION' && f.generateSearchablePdf)
    ) {
      issue('Searchable PDF generation requires a processor job')
    }
    const inline = input.source === 'file' || input.operation === 'analyze_document'
    if (inline) {
      for (const ranges of [input.pageRange, ...(input.objects?.map((o) => o.pageRange) ?? [])]) {
        if (!ranges) continue
        const pages = new Set<number>()
        for (const range of ranges) {
          const [start, end = start] = range.split('-').map(Number)
          for (let page = start; page <= end && pages.size <= 5; page++) pages.add(page)
        }
        if (pages.size > 5) {
          issue('Inline and synchronous analysis accepts at most five selected pages')
        }
      }
    }
  })

export type DocumentInput = z.infer<typeof documentInputSchema>
export type AnalysisInput = Extract<
  DocumentInput,
  { operation: 'analyze_document' | 'create_processor_job' }
>
export type ProjectionInput = z.infer<z.ZodObject<typeof projection>>
