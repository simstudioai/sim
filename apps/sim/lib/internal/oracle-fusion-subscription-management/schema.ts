import { z } from 'zod'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import { encodeOracleFusionSubscriptionPublicKey } from '@/lib/internal/oracle-fusion-subscription-management/projectors'
import {
  getOracleFusionSubscriptionFields,
  getOracleFusionSubscriptionOperation,
  ORACLE_FUSION_SUBSCRIPTION_ENTITIES,
  ORACLE_FUSION_SUBSCRIPTION_OPERATIONS,
  type OracleFusionSubscriptionField,
} from '@/tools/oracle_fusion_subscription_management/shared'

export const oracleFusionSubscriptionIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}(?![\s\S])/, 'Expected an exact positive decimal identifier string')
  .refine(
    (value) => /^[1-9]\d{0,18}(?![\s\S])/.test(value) && BigInt(value) <= 9223372036854775807n,
    'Identifier exceeds signed int64'
  )

export const oracleFusionSubscriptionRuleIdSchema = z
  .string()
  .regex(/^(?:0|-?[1-9]\d{0,18})(?![\s\S])/, 'Expected an exact signed decimal rule identifier')
  .refine(
    (value) =>
      /^(?:0|-?[1-9]\d{0,18})(?![\s\S])/.test(value) &&
      BigInt(value) >= -9223372036854775808n &&
      BigInt(value) <= 9223372036854775807n,
    'Rule identifier exceeds signed int64'
  )

export const oracleFusionSubscriptionKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      encodeOracleFusionPathSegment(value)
      return value.trim() === value
    } catch {
      return false
    }
  }, 'Expected one opaque Oracle resource key, not a URL')

export const oracleFusionSubscriptionPublicKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (
      value.trim() !== value ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      return false
    }
    try {
      encodeOracleFusionSubscriptionPublicKey(value)
      return true
    } catch {
      return false
    }
  }, 'Expected an exact Oracle public number or PUID, not a URL')

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
  }, 'Expected a calendar date in YYYY-MM-DD format')

export const oracleFusionSubscriptionPageSchema = z.object({
  q: z.string().min(1).max(2048).optional(),
  finder: z.string().min(1).max(2048).optional(),
  orderBy: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 100)
    .default(0),
  totalResults: z.boolean().default(false),
})

function fieldSchema(field: OracleFusionSubscriptionField): z.ZodType {
  let schema: z.ZodType
  switch (field.kind) {
    case 'id':
      schema = oracleFusionSubscriptionIdSchema
      break
    case 'ruleId':
      schema = oracleFusionSubscriptionRuleIdSchema
      break
    case 'number':
      schema = z.number().finite()
      break
    case 'integer':
      schema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
      break
    case 'boolean':
      schema = z.boolean()
      break
    case 'date':
      schema = date
      break
    case 'datetime':
      schema = z.string().datetime({ offset: true })
      break
    default:
      schema = z.string().max(field.max ?? 32000)
      if (!field.nullable)
        schema = z
          .string()
          .min(1)
          .max(field.max ?? 32000)
  }
  if (
    field.oracle.endsWith('Puid') ||
    field.oracle === 'SubscriptionNumber' ||
    field.param === 'newSubscriptionNumber'
  ) {
    schema = oracleFusionSubscriptionPublicKeySchema
    if (field.max) schema = schema.refine((value) => String(value).length <= field.max!)
  }
  return field.nullable ? schema.nullable() : schema
}

function createInputSchema(name: string) {
  const operation = getOracleFusionSubscriptionOperation(name)
  const entity = ORACLE_FUSION_SUBSCRIPTION_ENTITIES[operation.entity]
  const shape: Record<string, z.ZodType> = {
    oauthCredential: z.string().min(1).max(512),
    accessToken: z.string().min(1).max(4096),
    instanceUrl: z.string().min(1).max(2048),
  }
  for (const parent of entity.parents) shape[parent] = oracleFusionSubscriptionPublicKeySchema
  if (['get', 'update', 'delete', 'action'].includes(operation.kind)) {
    shape[entity.keyParam] = entity.publicKey
      ? oracleFusionSubscriptionPublicKeySchema
      : oracleFusionSubscriptionKeySchema
  }
  if (entity.scope) {
    shape.billingScope = z.enum(['product', 'covered_level']).default('product')
    shape.coveredLevelPuid = oracleFusionSubscriptionPublicKeySchema.optional()
  }
  if (operation.kind === 'list') Object.assign(shape, oracleFusionSubscriptionPageSchema.shape)
  const fields = getOracleFusionSubscriptionFields(operation)
  for (const field of fields) {
    const schema = fieldSchema(field)
    shape[field.param] = operation.kind === 'create' && field.required ? schema : schema.optional()
  }
  return z
    .object(shape)
    .strict()
    .superRefine((input, context) => {
      const issue = (path: string, message: string) =>
        context.addIssue({ code: 'custom', path: [path], message })
      if (entity.scope) {
        if (input.billingScope === 'covered_level' && !input.coveredLevelPuid) {
          issue('coveredLevelPuid', 'Required for covered_level billing scope')
        }
        if (input.billingScope === 'product' && input.coveredLevelPuid !== undefined) {
          issue('coveredLevelPuid', 'Omit coveredLevelPuid for product billing scope')
        }
      }
      if (operation.kind === 'create') {
        for (const field of fields.filter((field) => field.required)) {
          const value = input[field.param]
          if (value === null || (typeof value === 'string' && !value.trim())) {
            issue(field.param, 'Required value must not be blank or null')
          }
        }
      }
      if (
        operation.kind === 'update' &&
        !fields.some((field) => input[field.param] !== undefined)
      ) {
        issue('operation', 'Provide at least one writable field to update')
      }
      if (
        typeof input.startDate === 'string' &&
        typeof input.endDate === 'string' &&
        input.endDate < input.startDate
      ) {
        issue('endDate', 'End date must not precede start date')
      }
    })
}

const inputSchemas = Object.fromEntries(
  Object.keys(ORACLE_FUSION_SUBSCRIPTION_OPERATIONS).map((name) => [name, createInputSchema(name)])
)

export interface OracleFusionSubscriptionInput extends Record<string, unknown> {
  oauthCredential: string
  accessToken: string
  instanceUrl: string
}

/** Strict product validation runs before any path or request body is constructed. */
export function parseOracleFusionSubscriptionInput(
  name: string,
  input: unknown
): OracleFusionSubscriptionInput {
  getOracleFusionSubscriptionOperation(name)
  return inputSchemas[name].parse(input) as OracleFusionSubscriptionInput
}
