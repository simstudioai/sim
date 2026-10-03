import { z } from 'zod'

const MAX_DOCUMENT_CONTENT_LENGTH = 2_000_000
const MAX_REPLACEMENTS_LENGTH = 200_000

function isPlaceholderMap(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.keys(value).every((key) => key.trim().length > 0)
}

function isPlaceholderMapString(value: string): boolean {
  if (!value.trim()) return true
  try {
    return isPlaceholderMap(JSON.parse(value))
  } catch {
    return false
  }
}

const wordReplacementsSchema = z
  .union([
    z
      .string()
      .refine(
        isPlaceholderMapString,
        'Placeholder values must be a JSON object mapping each non-empty placeholder to its value'
      ),
    z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .refine(isPlaceholderMap, 'Every placeholder must be a non-empty string'),
  ])
  .refine(
    (value) =>
      (typeof value === 'string' ? value.length : JSON.stringify(value).length) <=
      MAX_REPLACEMENTS_LENGTH,
    'Placeholder values are too long'
  )

const accessTokenSchema = z.string().min(1, 'Access token is required')
const documentIdSchema = z.string().min(1, 'Document ID is required')
const driveIdSchema = z.string().optional().nullable()

export const microsoftWordCreateInputSchema = z.object({
  accessToken: accessTokenSchema,
  name: z.string().min(1, 'Document name is required').max(255, 'Document name is too long'),
  content: z
    .string()
    .max(MAX_DOCUMENT_CONTENT_LENGTH, 'Document content is too long')
    .optional()
    .nullable(),
  folderId: z.string().optional().nullable(),
  driveId: driveIdSchema,
})

export const microsoftWordReadInputSchema = z.object({
  accessToken: accessTokenSchema,
  documentId: documentIdSchema,
  driveId: driveIdSchema,
})

export const microsoftWordUpdateInputSchema = z.object({
  accessToken: accessTokenSchema,
  documentId: documentIdSchema,
  content: z
    .string()
    .min(1, 'Document content is required')
    .max(MAX_DOCUMENT_CONTENT_LENGTH, 'Document content is too long'),
  driveId: driveIdSchema,
})

export const microsoftWordAppendInputSchema = microsoftWordUpdateInputSchema

export const microsoftWordCreateFromTemplateInputSchema = z.object({
  accessToken: accessTokenSchema,
  templateDocumentId: z.string().min(1, 'Template document ID is required'),
  name: z.string().min(1, 'Document name is required').max(255, 'Document name is too long'),
  replacements: wordReplacementsSchema.optional().nullable(),
  matchCase: z.boolean().optional().nullable(),
  folderId: z.string().optional().nullable(),
  driveId: driveIdSchema,
})

export const microsoftWordReplaceTextInputSchema = z.object({
  accessToken: accessTokenSchema,
  documentId: documentIdSchema,
  findText: z.string().min(1, 'Search text is required').max(4000, 'Search text is too long'),
  replaceText: z.string().max(20000, 'Replacement text is too long').optional().nullable(),
  matchCase: z.boolean().optional().nullable(),
  driveId: driveIdSchema,
})

export const microsoftWordExportPdfInputSchema = z.object({
  accessToken: accessTokenSchema,
  documentId: documentIdSchema,
  fileName: z.string().optional().nullable(),
  driveId: driveIdSchema,
})

export type MicrosoftWordCreateInput = z.output<typeof microsoftWordCreateInputSchema>
export type MicrosoftWordReadInput = z.output<typeof microsoftWordReadInputSchema>
export type MicrosoftWordUpdateInput = z.output<typeof microsoftWordUpdateInputSchema>
export type MicrosoftWordAppendInput = z.output<typeof microsoftWordAppendInputSchema>
export type MicrosoftWordCreateFromTemplateInput = z.output<
  typeof microsoftWordCreateFromTemplateInputSchema
>
export type MicrosoftWordReplaceTextInput = z.output<typeof microsoftWordReplaceTextInputSchema>
export type MicrosoftWordExportPdfInput = z.output<typeof microsoftWordExportPdfInputSchema>
