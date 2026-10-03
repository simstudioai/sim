import { z } from 'zod'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import { encodeOracleFusionSalesPublicNumber } from '@/lib/internal/oracle-fusion-sales/projectors'
import {
  getOracleFusionSalesOperation,
  ORACLE_FUSION_SALES_ENTITIES,
  ORACLE_FUSION_SALES_OPERATIONS,
  type OracleFusionSalesField,
} from '@/tools/oracle_fusion_sales/shared'

/** Oracle numeric identifiers are validated as strings before exact-integer construction. */
export const oracleFusionSalesIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/, 'Expected a positive decimal identifier string')
  .refine(
    (value) =>
      value.trim() === value &&
      /^[1-9]\d{0,18}$/.test(value) &&
      BigInt(value) <= 9223372036854775807n,
    'Identifier exceeds the signed 64-bit range'
  )

export const oracleFusionSalesKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      encodeOracleFusionPathSegment(value)
      return true
    } catch {
      return false
    }
  }, 'Expected one Oracle resource key or public number, not a URL')

export const oracleFusionSalesPublicNumberSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (
      value.trim() !== value ||
      /^[a-z][a-z0-9+.-]*:/i.test(value) ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      return false
    }
    try {
      encodeOracleFusionSalesPublicNumber(value)
      return true
    } catch {
      return false
    }
  }, 'Expected an Oracle public number, not a URL')

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
  }, 'Expected a calendar date in YYYY-MM-DD format')

const stringMap = z
  .record(z.string().min(1).max(256), z.string().max(4000))
  .refine(
    (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 100,
    'Provide between 1 and 100 string-valued fields'
  )

export const oracleFusionSalesPageSchema = z.object({
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

function fieldSchema(field: OracleFusionSalesField): z.ZodType {
  let schema: z.ZodType
  switch (field.kind) {
    case 'id':
      schema = oracleFusionSalesIdSchema
      break
    case 'number':
      schema = z.number().finite()
      break
    case 'integer':
      schema = z.number().int().min(-2147483648).max(2147483647)
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
      schema = field.nullable
        ? z.string().max(field.max ?? 32000)
        : z
            .string()
            .min(1)
            .max(field.max ?? 32000)
            .refine((value) => Boolean(value.trim()))
  }
  if (field.param === 'winProbability' || field.param === 'percentageComplete') {
    schema = z.number().min(0).max(100)
    if (field.kind === 'integer') schema = z.number().int().min(0).max(100)
  }
  return field.nullable ? schema.nullable() : schema
}

function createInputSchema(name: string) {
  const operation = getOracleFusionSalesOperation(name)
  const entity = ORACLE_FUSION_SALES_ENTITIES[operation.entity]
  const shape: Record<string, z.ZodType> = {
    oauthCredential: z.string().min(1).max(512),
    accessToken: z.string().min(1).max(4096),
    instanceUrl: z.string().min(1).max(2048),
  }
  if (entity.parentParam) shape[entity.parentParam] = oracleFusionSalesPublicNumberSchema
  if (['get', 'update', 'delete'].includes(operation.kind)) {
    shape[entity.keyParam] =
      operation.entity === 'opportunityContact'
        ? oracleFusionSalesIdSchema
        : entity.publicKey
          ? oracleFusionSalesPublicNumberSchema
          : oracleFusionSalesKeySchema
  }
  if (operation.kind === 'list') Object.assign(shape, oracleFusionSalesPageSchema.shape)
  if (operation.kind === 'create' || operation.kind === 'update') {
    for (const field of entity.fields) {
      if (operation.kind === 'update' && !field.update) continue
      const schema = fieldSchema(field)
      shape[field.param] = operation.required.includes(field.param) ? schema : schema.optional()
    }
  }
  if (operation.kind === 'action') {
    shape[operation.entity === 'lead' ? 'leadId' : entity.keyParam] =
      operation.entity === 'lead' ? oracleFusionSalesIdSchema : oracleFusionSalesPublicNumberSchema
    if (name === 'reject_lead') {
      shape.reason = z.string().min(1).max(4000).optional()
      shape.comments = z.string().max(4000).optional()
    }
    if (name === 'convert_lead') {
      shape.opportunityName = z.string().min(1).max(275).optional()
      shape.opportunityOwnerNumber = oracleFusionSalesPublicNumberSchema.optional()
      shape.attributeMap = stringMap.optional()
    }
  }
  if (operation.kind === 'duplicates') {
    shape.matchingFields = stringMap
    if (operation.entity === 'contact')
      shape.accountNumber = oracleFusionSalesPublicNumberSchema.optional()
  }
  return z
    .object(shape)
    .strict()
    .superRefine((input, context) => {
      const issue = (path: string, message: string) =>
        context.addIssue({ code: 'custom', path: [path], message })
      for (const key of operation.required) {
        if (input[key] === null || (typeof input[key] === 'string' && !input[key].trim())) {
          issue(key, 'Required value must not be blank or null')
        }
      }
      if (
        name === 'create_contact' &&
        !(typeof input.firstName === 'string' && input.firstName.trim()) &&
        !(typeof input.lastName === 'string' && input.lastName.trim())
      ) {
        issue('firstName', 'Provide at least firstName or lastName')
      }
      if (
        operation.kind === 'update' &&
        !entity.fields.some((field) => field.update && input[field.param] !== undefined)
      ) {
        issue('operation', 'Provide at least one writable field to update')
      }
      if (name === 'create_opportunity_revenue') {
        const group = input.productGroupId != null
        const item = input.inventoryItemId != null
        const organization = input.inventoryOrganizationId != null
        if (!group && !(item && organization)) {
          issue('productGroupId', 'Provide productGroupId or both inventory product identifiers')
        }
        if (item !== organization) {
          issue(
            'inventoryOrganizationId',
            'Inventory item and organization identifiers must be paired'
          )
        }
        if (group && item) {
          issue('productGroupId', 'Choose a product group or inventory product, not both')
        }
      }
      if (
        typeof input.startDateTime === 'string' &&
        typeof input.endDateTime === 'string' &&
        Date.parse(input.endDateTime) < Date.parse(input.startDateTime)
      ) {
        issue('endDateTime', 'End date-time must not precede start date-time')
      }
    })
}

const inputSchemas = Object.fromEntries(
  Object.keys(ORACLE_FUSION_SALES_OPERATIONS).map((name) => [name, createInputSchema(name)])
)

export interface OracleFusionSalesInput extends Record<string, unknown> {
  oauthCredential: string
  accessToken: string
  instanceUrl: string
}

/** Validates one registered operation; callers must not bypass this before constructing bodies. */
export function parseOracleFusionSalesInput(name: string, input: unknown): OracleFusionSalesInput {
  getOracleFusionSalesOperation(name)
  return inputSchemas[name].parse(input) as OracleFusionSalesInput
}
