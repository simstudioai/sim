import { z } from 'zod'
import {
  nonEmptyIdSchema,
  userFileSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const MAX_CREDENTIAL_LENGTH = 8192
const MAX_OID_LENGTH = 512
const MAX_TEXT_LENGTH = 4096
const MAX_ATTRIBUTES = 100
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

const attributeValueSchema = z.union([
  z.string().max(MAX_TEXT_LENGTH, 'Attribute value is too long'),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
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

const credentialsSchema = z.object({
  baseUrl: baseUrlSchema,
  username: credentialSchema,
  password: credentialSchema,
})

const executionContextSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  workflowId: workflowIdSchema.optional(),
  executionId: nonEmptyIdSchema.optional(),
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
  attributes: attributesSchema.refine((attributes) => Object.keys(attributes).length > 0, {
    message: 'At least one document attribute is required',
  }),
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
    attributes: attributesSchema.refine((attributes) => Object.keys(attributes).length > 0, {
      message: 'At least one document attribute is required',
    }),
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
    versionId: optionalTextSchema,
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

const downloadPrimarySchema = credentialsSchema.merge(executionContextSchema).extend({
  operation: z.literal('windchill_download_primary_content'),
  documentOid: oidSchema,
  fileName: z.string().trim().min(1).max(255).optional(),
})

const uploadPrimarySchema = credentialsSchema.extend({
  operation: z.literal('windchill_upload_primary_content'),
  documentOid: oidSchema,
  primaryFile: RawFileInputSchema,
})

const downloadAttachmentSchema = credentialsSchema.merge(executionContextSchema).extend({
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

const nullableId = z.string().max(MAX_OID_LENGTH).nullable()
const nullableText = z.string().max(MAX_TEXT_LENGTH).nullable()
const documentSchema = z.object({
  id: nullableId,
  name: nullableText,
  number: nullableText,
  title: nullableText,
  description: nullableText,
  state: nullableText,
  versionId: nullableText,
  revision: nullableText,
  version: nullableText,
  latest: z.boolean().nullable(),
  checkoutState: nullableText,
  folderName: nullableText,
  folderLocation: nullableText,
})

const operationSchema = z.enum([
  'windchill_create_document',
  'windchill_create_documents',
  'windchill_update_document',
  'windchill_update_documents',
  'windchill_delete_document',
  'windchill_delete_documents',
  'windchill_check_out_document',
  'windchill_check_out_documents',
  'windchill_check_in_document',
  'windchill_check_in_documents',
  'windchill_undo_check_out_document',
  'windchill_undo_check_out_documents',
  'windchill_revise_document',
  'windchill_revise_documents',
  'windchill_set_lifecycle_state',
  'windchill_update_document_security_labels',
  'windchill_download_primary_content',
  'windchill_upload_primary_content',
  'windchill_download_attachment',
  'windchill_upload_attachments',
])

export const windchillOperationOutputSchema = z.object({
  operation: operationSchema,
  affectedIds: z.array(oidSchema).max(MAX_BULK_DOCUMENTS).optional(),
  document: documentSchema.nullable().optional(),
  documents: z.array(documentSchema).max(MAX_BULK_DOCUMENTS).optional(),
  uploadedFileNames: z.array(z.string().min(1).max(255)).max(MAX_ATTACHMENT_FILES).optional(),
  file: userFileSchema.optional(),
  fileName: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).max(255).optional(),
})

export const windchillOperationResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    output: windchillOperationOutputSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1).max(MAX_TEXT_LENGTH),
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
