import { z } from 'zod'
import type { RecursiveRecipe } from '@/lib/chunkers/types'

/**
 * Recipes the recursive chunker implements. Mirrors `RecursiveRecipe`; the
 * `satisfies` keeps a rename or removal there a compile error here.
 */
const RECURSIVE_RECIPES = [
  'plain',
  'markdown',
  'code',
] as const satisfies readonly RecursiveRecipe[]

/**
 * Recipes accepted on a document upload. `'default'` is not a chunker recipe —
 * it is the long-standing sentinel every first-party caller sends to mean "use
 * the knowledge base's configured strategy", so it must stay accepted.
 */
export const KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES = ['default', ...RECURSIVE_RECIPES] as const

export type KnowledgeDocumentUploadRecipe = (typeof KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES)[number]

/**
 * The shape a language tag must have: a 2-8 letter primary subtag followed by
 * any number of alphanumeric subtags, e.g. `en`, `en-US`, `zh-Hant-TW`.
 *
 * A shape check, not BCP-47 conformance. It still admits a malformed tag such
 * as `en-a`, whose trailing singleton RFC 5646 requires to be followed by
 * extension subtags. `lang` is carried through the processing payload untouched
 * and read by nothing that chunks or parses the document, so a parser sized to
 * reject that would cost more than the field is worth — the message below
 * therefore claims only the shape that is actually enforced.
 */
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

const knowledgeDocumentUploadTagSchema = z
  .string()
  .max(1000, 'Knowledge document tag values cannot exceed 1000 characters')
  .optional()

const knowledgeDocumentUploadTagShape = {
  tag1: knowledgeDocumentUploadTagSchema,
  tag2: knowledgeDocumentUploadTagSchema,
  tag3: knowledgeDocumentUploadTagSchema,
  tag4: knowledgeDocumentUploadTagSchema,
  tag5: knowledgeDocumentUploadTagSchema,
  tag6: knowledgeDocumentUploadTagSchema,
  tag7: knowledgeDocumentUploadTagSchema,
}

const recipeSchema = z.enum(KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES, {
  error: `recipe must be one of: ${KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES.join(', ')}`,
})

const langSchema = z
  .string()
  .max(35, 'lang cannot exceed 35 characters')
  .regex(
    LANGUAGE_TAG_SHAPE,
    'lang must be hyphen-separated letter and digit subtags, for example "en" or "en-US"'
  )

/** Persisted metadata stored with a resumable Knowledge document upload session. */
export const knowledgeDocumentUploadMetadataSchema = z
  .object({
    ...knowledgeDocumentUploadTagShape,
    processingOptions: z
      .object({
        recipe: recipeSchema.optional(),
        lang: langSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type KnowledgeDocumentUploadMetadata = z.output<typeof knowledgeDocumentUploadMetadataSchema>

/**
 * Read-back variant for metadata already persisted on an upload session.
 *
 * The strict schema above is a *request* boundary and rejects an unrecognized
 * `recipe`/`lang`. Sessions created before those constraints existed can carry
 * values that no longer parse, and rejecting them here would throw a raw
 * `ZodError` out of resume/complete — a 500 on a session that could never be
 * finished. Unrecognized values are dropped instead; neither field affects
 * processing today, so dropping one changes nothing but the analytics property.
 */
export const persistedKnowledgeDocumentUploadMetadataSchema = z
  .object({
    ...knowledgeDocumentUploadTagShape,
    processingOptions: z
      .object({
        recipe: recipeSchema.optional().catch(undefined),
        lang: langSchema.optional().catch(undefined),
      })
      .strict()
      .optional(),
  })
  .strict()
