import { z } from 'zod'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/**
 * Connection fields shared by every Athena tool contract.
 */
export const athenaConnectionSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
})

/**
 * Workgroup names follow the Athena pattern `[a-zA-Z0-9._-]{1,128}`.
 */
export const athenaWorkGroupSchema = z
  .string()
  .trim()
  .min(1, 'Workgroup is required')
  .max(128, 'Workgroup must be at most 128 characters')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Workgroup may only contain letters, digits, ".", "_", and "-"')

/**
 * Optional workgroup; blank strings from unfilled inputs are treated as omitted.
 */
export const athenaOptionalWorkGroupSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  athenaWorkGroupSchema.optional()
)

/**
 * Prepared statement names follow the Athena pattern `[a-zA-Z_][a-zA-Z0-9_@:]{1,256}`.
 */
export const athenaStatementNameSchema = z
  .string()
  .trim()
  .min(1, 'Statement name is required')
  .max(256, 'Statement name must be at most 256 characters')
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_@:]+$/,
    'Statement name must start with a letter or underscore and contain only letters, digits, "_", "@", and ":"'
  )

/**
 * Builds the optional `maxResults` field with Athena's documented bounds for the operation.
 */
export function athenaMaxResultsSchema(min: number, max: number) {
  return z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional()
  )
}

export const athenaNextTokenSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().min(1).max(1024).optional()
)

export const athenaNamedQuerySchema = z.object({
  namedQueryId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  database: z.string(),
  queryString: z.string(),
  workGroup: z.string().nullable(),
})

export const athenaPreparedStatementSchema = z.object({
  statementName: z.string(),
  queryStatement: z.string(),
  workGroupName: z.string().nullable(),
  description: z.string().nullable(),
  lastModifiedTime: z.number().nullable(),
})

export const athenaDatabaseSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  parameters: z.record(z.string(), z.string()),
})

export const athenaColumnSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  comment: z.string().nullable(),
})

export const athenaTableMetadataSchema = z.object({
  name: z.string(),
  tableType: z.string().nullable(),
  createTime: z.number().nullable(),
  lastAccessTime: z.number().nullable(),
  columns: z.array(athenaColumnSchema),
  partitionKeys: z.array(athenaColumnSchema),
  parameters: z.record(z.string(), z.string()),
})

export const athenaEngineVersionSchema = z.object({
  selectedEngineVersion: z.string().nullable(),
  effectiveEngineVersion: z.string().nullable(),
})

export const athenaSuccessResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({ success: z.literal(true) }),
})
