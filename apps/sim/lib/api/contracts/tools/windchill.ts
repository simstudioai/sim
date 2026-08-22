import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const MAX_CREDENTIAL_LENGTH = 8192
const MAX_OID_LENGTH = 512
const MAX_TEXT_LENGTH = 4096
const MAX_ATTRIBUTES = 100
const MAX_ATTRIBUTE_DEPTH = 8
const MAX_ATTRIBUTE_NODES = 1000
const MAX_BULK_DOCUMENTS = 100
const MAX_ATTACHMENT_FILES = 10

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const credentialSchema = z
  .string({ error: 'Credential is required' })
  .min(1, 'Credential is required')
  .max(MAX_CREDENTIAL_LENGTH, 'Credential is too long')

const baseUrlSchema = z
  .url('Windchill base URL must be a valid URL')
  .max(2048, 'Windchill base URL is too long')
  .refine((value) => value.startsWith('https://'), 'Windchill base URL must use HTTPS')
  .refine((value) => {
    const parsed = parseUrl(value)
    return Boolean(parsed && !parsed.username && !parsed.password && !parsed.search && !parsed.hash)
  }, 'Windchill base URL must not include credentials, query parameters, or a hash')
  .refine((value) => {
    const parsed = parseUrl(value)
    return Boolean(parsed && /\/servlet\/odata\/v\d+\/?$/i.test(parsed.pathname))
  }, 'Windchill base URL must end with a versioned /servlet/odata/vN path')

const oidSchema = z
  .string({ error: 'Windchill OID is required' })
  .trim()
  .min(1, 'Windchill OID is required')
  .max(MAX_OID_LENGTH, 'Windchill OID is too long')
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Windchill OID contains unsupported characters')

const optionalTextSchema = z.string().max(MAX_TEXT_LENGTH, 'Value is too long').optional()
const requiredTextSchema = z
  .string({ error: 'Value is required' })
  .trim()
  .min(1, 'Value is required')
  .max(MAX_TEXT_LENGTH, 'Value is too long')

type WindchillAttributeValue =
  | string
  | number
  | boolean
  | null
  | WindchillAttributeValue[]
  | { [key: string]: WindchillAttributeValue }

function isBoundedAttributeValue(value: unknown): value is WindchillAttributeValue {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || current.depth > MAX_ATTRIBUTE_DEPTH || ++nodes > MAX_ATTRIBUTE_NODES) {
      return false
    }
    if (
      current.value === null ||
      typeof current.value === 'boolean' ||
      (typeof current.value === 'number' && Number.isFinite(current.value))
    ) {
      continue
    }
    if (typeof current.value === 'string') {
      if (current.value.length > MAX_TEXT_LENGTH) return false
      continue
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_ATTRIBUTES) return false
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 })
      continue
    }
    if (typeof current.value !== 'object') return false

    const entries = Object.entries(current.value)
    if (entries.length > MAX_ATTRIBUTES) return false
    for (const [key, nested] of entries) {
      if (
        key.length === 0 ||
        key.length > 256 ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        return false
      }
      pending.push({ value: nested, depth: current.depth + 1 })
    }
  }
  return true
}

const attributeValueSchema = z.custom<WindchillAttributeValue>(isBoundedAttributeValue, {
  message: `Attribute values must be bounded JSON with at most ${MAX_ATTRIBUTE_DEPTH} nested levels`,
})
const attributeNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z_][A-Za-z0-9_.]*$/, 'Attribute name contains unsupported characters')
  .refine(
    (value) => !['__proto__', 'constructor', 'prototype'].includes(value),
    'Attribute name is reserved'
  )

const attributesSchema = z
  .record(attributeNameSchema, attributeValueSchema)
  .refine((attributes) => Object.keys(attributes).length <= MAX_ATTRIBUTES, {
    message: `Attributes cannot contain more than ${MAX_ATTRIBUTES} fields`,
  })

const COMMON_DOCUMENT_PROPERTIES = new Set(['Name', 'Number', 'Organization'])
const patchAttributesSchema = attributesSchema
  .refine((attributes) => Object.keys(attributes).length > 0, {
    message: 'At least one document attribute is required',
  })
  .refine(
    (attributes) => !Object.keys(attributes).some((key) => COMMON_DOCUMENT_PROPERTIES.has(key)),
    'Name, Number, and Organization must be changed with the Update Common Properties operation and are not supported here'
  )

const commonPropertiesSchema = attributesSchema.refine(
  (properties) => Object.keys(properties).length > 0,
  { message: 'At least one common property is required' }
)

const credentialsSchema = z.object({
  baseUrl: baseUrlSchema,
  username: credentialSchema,
  password: credentialSchema,
})

const createDocumentInputSchema = z.object({
  name: requiredTextSchema,
  containerOid: oidSchema,
  number: optionalTextSchema,
  title: optionalTextSchema,
  description: optionalTextSchema,
  folderOid: oidSchema.optional(),
  attributes: attributesSchema.optional(),
})

const updateDocumentInputSchema = z.object({
  id: oidSchema,
  attributes: patchAttributesSchema,
})

const documentOidsSchema = z
  .array(oidSchema)
  .min(1, 'At least one document OID is required')
  .max(MAX_BULK_DOCUMENTS, `At most ${MAX_BULK_DOCUMENTS} documents can be processed at once`)
  .refine((ids) => new Set(ids).size === ids.length, 'Document OIDs must be unique')

const commonMutationShapes = {
  createDocument: credentialsSchema.extend({
    operation: z.literal('windchill_create_document'),
    name: requiredTextSchema,
    containerOid: oidSchema,
    number: optionalTextSchema,
    title: optionalTextSchema,
    description: optionalTextSchema,
    folderOid: oidSchema.optional(),
    attributes: attributesSchema.optional(),
  }),
  createDocuments: credentialsSchema.extend({
    operation: z.literal('windchill_create_documents'),
    documents: z
      .array(createDocumentInputSchema)
      .min(1, 'At least one document is required')
      .max(MAX_BULK_DOCUMENTS),
  }),
  updateDocument: credentialsSchema.extend({
    operation: z.literal('windchill_update_document'),
    documentOid: oidSchema,
    attributes: patchAttributesSchema,
  }),
  updateCommonProperties: credentialsSchema.extend({
    operation: z.literal('windchill_update_common_properties'),
    documentOid: oidSchema,
    commonProperties: commonPropertiesSchema,
  }),
  updateDocuments: credentialsSchema.extend({
    operation: z.literal('windchill_update_documents'),
    documents: z
      .array(updateDocumentInputSchema)
      .min(1, 'At least one document is required')
      .max(MAX_BULK_DOCUMENTS),
  }),
  deleteDocument: credentialsSchema.extend({
    operation: z.literal('windchill_delete_document'),
    documentOid: oidSchema,
  }),
  deleteDocuments: credentialsSchema.extend({
    operation: z.literal('windchill_delete_documents'),
    documentOids: documentOidsSchema,
  }),
  checkOutDocument: credentialsSchema.extend({
    operation: z.literal('windchill_check_out_document'),
    documentOid: oidSchema,
    checkOutNote: optionalTextSchema,
  }),
  checkOutDocuments: credentialsSchema.extend({
    operation: z.literal('windchill_check_out_documents'),
    documentOids: documentOidsSchema,
    checkOutNote: optionalTextSchema,
  }),
  checkInDocument: credentialsSchema.extend({
    operation: z.literal('windchill_check_in_document'),
    documentOid: oidSchema,
    checkInNote: optionalTextSchema,
    keepCheckedOut: z.boolean().optional(),
    checkOutNote: optionalTextSchema,
  }),
  checkInDocuments: credentialsSchema.extend({
    operation: z.literal('windchill_check_in_documents'),
    documentOids: documentOidsSchema,
    checkInNote: optionalTextSchema,
    keepCheckedOut: z.boolean().optional(),
    checkOutNote: optionalTextSchema,
  }),
  undoCheckOutDocument: credentialsSchema.extend({
    operation: z.literal('windchill_undo_check_out_document'),
    documentOid: oidSchema,
  }),
  undoCheckOutDocuments: credentialsSchema.extend({
    operation: z.literal('windchill_undo_check_out_documents'),
    documentOids: documentOidsSchema,
  }),
  reviseDocument: credentialsSchema.extend({
    operation: z.literal('windchill_revise_document'),
    documentOid: oidSchema,
    versionId: optionalTextSchema,
  }),
  reviseDocuments: credentialsSchema.extend({
    operation: z.literal('windchill_revise_documents'),
    documentOids: documentOidsSchema,
  }),
  setLifecycleState: credentialsSchema.extend({
    operation: z.literal('windchill_set_lifecycle_state'),
    documentOid: oidSchema,
    stateValue: requiredTextSchema,
    stateDisplay: requiredTextSchema,
  }),
  updateSecurityLabels: credentialsSchema.extend({
    operation: z.literal('windchill_update_document_security_labels'),
    securityLabelUpdates: z
      .array(
        z.object({
          id: oidSchema,
          labels: z
            .record(attributeNameSchema, z.string().max(MAX_TEXT_LENGTH))
            .refine((labels) => Object.keys(labels).length > 0, {
              message: 'At least one security label is required',
            })
            .refine((labels) => Object.keys(labels).length <= MAX_ATTRIBUTES, {
              message: `Security labels cannot contain more than ${MAX_ATTRIBUTES} fields`,
            }),
        })
      )
      .min(1, 'At least one document security-label update is required')
      .max(MAX_BULK_DOCUMENTS),
  }),
} as const

const downloadPrimarySchema = credentialsSchema.extend({
  operation: z.literal('windchill_download_primary_content'),
  documentOid: oidSchema,
  fileName: z.string().trim().min(1).max(255).optional(),
})

const uploadPrimarySchema = credentialsSchema.extend({
  operation: z.literal('windchill_upload_primary_content'),
  documentOid: oidSchema,
  primaryFile: RawFileInputSchema,
})

const downloadAttachmentSchema = credentialsSchema.extend({
  operation: z.literal('windchill_download_attachment'),
  documentOid: oidSchema,
  attachmentOid: oidSchema,
  fileName: z.string().trim().min(1).max(255).optional(),
})

const uploadAttachmentsSchema = credentialsSchema.extend({
  operation: z.literal('windchill_upload_attachments'),
  documentOid: oidSchema,
  attachmentFiles: RawFileInputArraySchema.min(1, 'At least one attachment file is required').max(
    MAX_ATTACHMENT_FILES,
    `At most ${MAX_ATTACHMENT_FILES} attachments can be uploaded at once`
  ),
})

export const windchillOperationBodySchema = z.discriminatedUnion('operation', [
  commonMutationShapes.createDocument,
  commonMutationShapes.createDocuments,
  commonMutationShapes.updateDocument,
  commonMutationShapes.updateCommonProperties,
  commonMutationShapes.updateDocuments,
  commonMutationShapes.deleteDocument,
  commonMutationShapes.deleteDocuments,
  commonMutationShapes.checkOutDocument,
  commonMutationShapes.checkOutDocuments,
  commonMutationShapes.checkInDocument,
  commonMutationShapes.checkInDocuments,
  commonMutationShapes.undoCheckOutDocument,
  commonMutationShapes.undoCheckOutDocuments,
  commonMutationShapes.reviseDocument,
  commonMutationShapes.reviseDocuments,
  commonMutationShapes.setLifecycleState,
  commonMutationShapes.updateSecurityLabels,
  downloadPrimarySchema,
  uploadPrimarySchema,
  downloadAttachmentSchema,
  uploadAttachmentsSchema,
])

/**
 * Response primitives are deliberately looser than their request counterparts: these values are
 * whatever the customer's Windchill returned, so re-applying the request-side OID regex or text
 * bounds would turn an already-committed mutation into an opaque parse failure.
 */
const returnedOidSchema = z.string().min(1)
const nullableId = z.string().nullable()
const nullableText = z.string().nullable()
const documentSchema = z.object({
  id: nullableId,
  name: nullableText,
  number: nullableText,
  title: nullableText,
  description: nullableText,
  state: nullableText,
  stateDisplay: nullableText,
  versionId: nullableText,
  revision: nullableText,
  version: nullableText,
  latest: z.boolean().nullable(),
  checkoutState: nullableText,
  folderName: nullableText,
  folderLocation: nullableText,
})

const affectedIdsSchema = z.array(returnedOidSchema)
const singleMutationOperationSchema = z.enum([
  'windchill_create_document',
  'windchill_update_document',
  'windchill_update_common_properties',
  'windchill_check_out_document',
  'windchill_check_in_document',
  'windchill_undo_check_out_document',
  'windchill_revise_document',
  'windchill_set_lifecycle_state',
])
const bulkMutationOperationSchema = z.enum([
  'windchill_create_documents',
  'windchill_update_documents',
  'windchill_check_out_documents',
  'windchill_check_in_documents',
  'windchill_undo_check_out_documents',
  'windchill_revise_documents',
  'windchill_update_document_security_labels',
])
const deleteOperationSchema = z.enum(['windchill_delete_document', 'windchill_delete_documents'])
const downloadOperationSchema = z.enum([
  'windchill_download_primary_content',
  'windchill_download_attachment',
])
const uploadOperationSchema = z.enum([
  'windchill_upload_primary_content',
  'windchill_upload_attachments',
])

export const windchillOperationOutputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: singleMutationOperationSchema,
    affectedIds: affectedIdsSchema,
    document: documentSchema.optional(),
  }),
  z.object({
    operation: bulkMutationOperationSchema,
    affectedIds: affectedIdsSchema,
    documents: z.array(documentSchema).optional(),
  }),
  z.object({ operation: deleteOperationSchema, affectedIds: affectedIdsSchema }),
  z.object({
    operation: downloadOperationSchema,
    file: userFileSchema,
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
  }),
  z.object({
    operation: uploadOperationSchema,
    affectedIds: affectedIdsSchema,
    uploadedFileNames: z.array(z.string().min(1)),
  }),
])

export const windchillOperationResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    output: windchillOperationOutputSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1),
  }),
])

export const windchillOperationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/windchill',
  body: windchillOperationBodySchema,
  response: { mode: 'json', schema: windchillOperationResponseSchema },
})

export type WindchillOperationBody = ContractBodyInput<typeof windchillOperationContract>
export type WindchillOperationResponse = ContractJsonResponse<typeof windchillOperationContract>
