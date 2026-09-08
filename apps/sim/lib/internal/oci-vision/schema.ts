import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { parseRawFileInput, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { OCI_VISION_FEATURES, OCI_VISION_REGIONS } from '@/tools/oci_vision/shared'

const id = z.string().trim().min(1).max(255)
const optionalId = id.optional()
const objectName = z.string().min(1).max(1024)
const cursor = z.string().min(1).max(4096).optional()
const count = z.number().int().min(1).max(1000).optional()
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
const base = {
  credentialId: id,
  region: z.enum(OCI_VISION_REGIONS).optional(),
}
const featureFields = {
  features: z.preprocess(parseJson, z.array(z.enum(OCI_VISION_FEATURES)).min(1).max(4)),
  compartmentId: optionalId,
  classificationModelId: optionalId,
  objectDetectionModelId: optionalId,
  classificationMaxResults: count,
  objectDetectionMaxResults: count,
  faceMaxResults: count,
  shouldReturnLandmarks: z.boolean().optional(),
  language: z.literal('ENG').optional(),
}
const listFields = {
  compartmentId: id,
  limit: z.number().int().min(1).max(100).default(10),
  page: cursor,
  displayName: optionalId,
  lifecycleState: z
    .enum(['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED'])
    .optional(),
  id: optionalId,
  sortBy: z.enum(['timeCreated', 'displayName']).optional(),
  sortOrder: z.enum(['ASC', 'DESC']).optional(),
}

export const ociVisionObjectLocationSchema = z.object({
  namespaceName: id,
  bucketName: id,
  objectName,
})

const operationSchema = z.discriminatedUnion('operation', [
  z.object({
    ...base,
    ...featureFields,
    operation: z.literal('analyze_image'),
    source: z.enum(['file', 'object_storage']),
    file: z.preprocess(
      (value) => (value === undefined ? undefined : parseRawFileInput(value)),
      RawFileInputSchema.optional()
    ),
    namespaceName: optionalId,
    bucketName: optionalId,
    objectName: objectName.optional(),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  }),
  z.object({
    ...base,
    ...featureFields,
    operation: z.literal('create_image_job'),
    objectLocations: z.preprocess(
      parseJson,
      z.array(ociVisionObjectLocationSchema).min(1).max(2000)
    ),
    outputNamespaceName: id,
    outputBucketName: id,
    outputPrefix: z.string().min(1).max(1024),
    displayName: optionalId,
    isZipOutputEnabled: z.boolean().optional(),
    retryToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
  }),
  z.object({ ...base, operation: z.literal('get_image_job'), imageJobId: id }),
  z.object({
    ...base,
    operation: z.literal('cancel_image_job'),
    imageJobId: id,
    ifMatch: z.string().min(1).max(1024).optional(),
  }),
  z.object({ ...base, ...listFields, operation: z.literal('list_projects') }),
  z.object({ ...base, operation: z.literal('get_project'), projectId: id }),
  z.object({ ...base, ...listFields, operation: z.literal('list_models'), projectId: optionalId }),
  z.object({ ...base, operation: z.literal('get_model'), modelId: id }),
  z.object({
    ...base,
    operation: z.literal('list_image_job_outputs'),
    imageJobId: id,
    limit: z.number().int().min(1).max(100).default(10),
    start: cursor,
  }),
  z.object({
    ...base,
    operation: z.literal('download_image_job_output'),
    imageJobId: id,
    objectName,
    ifMatch: z.string().min(1).max(1024).optional(),
  }),
])

export const ociVisionInputSchema = operationSchema.superRefine((input, ctx) => {
  if (input.operation === 'analyze_image') {
    const hasObject =
      input.namespaceName !== undefined ||
      input.bucketName !== undefined ||
      input.objectName !== undefined
    if (input.source === 'file' && (!input.file || hasObject)) {
      ctx.addIssue({
        code: 'custom',
        message: 'File source requires only an uploaded file',
        path: ['file'],
      })
    }
    if (
      input.source === 'object_storage' &&
      (input.file || !input.namespaceName || !input.bucketName || !input.objectName)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Object Storage source requires namespace, bucket, and object name only',
        path: ['source'],
      })
    }
  }
  if (input.operation === 'analyze_image' || input.operation === 'create_image_job') {
    if (new Set(input.features).size !== input.features.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select each image feature only once',
        path: ['features'],
      })
    }
    for (const [feature, fields] of [
      ['IMAGE_CLASSIFICATION', ['classificationModelId', 'classificationMaxResults']],
      ['OBJECT_DETECTION', ['objectDetectionModelId', 'objectDetectionMaxResults']],
      ['TEXT_DETECTION', ['language']],
      ['FACE_DETECTION', ['faceMaxResults', 'shouldReturnLandmarks']],
    ] as const) {
      if (!input.features.includes(feature)) {
        for (const field of fields) {
          if (input[field] !== undefined) {
            ctx.addIssue({
              code: 'custom',
              message: `${field} requires ${feature}`,
              path: [field],
            })
          }
        }
      }
    }
  }
})

export type OciVisionInput = z.output<typeof ociVisionInputSchema>
export type OciVisionFeatureInput = Extract<
  OciVisionInput,
  { operation: 'analyze_image' | 'create_image_job' }
>
