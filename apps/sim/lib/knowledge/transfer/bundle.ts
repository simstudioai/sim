/**
 * The knowledge-base bundle: one zip holding a knowledge base's configuration,
 * tag definitions, original files, chunk text, and optionally chunk vectors.
 *
 * ```
 * files/<documentId>/<filename>   original blob, when the document has one
 * chunks/<documentId>.ndjson      one {@link KnowledgeBundleChunkLine} per line
 * manifest.json                   {@link KnowledgeBundleManifest}, written last
 * ```
 *
 * Nothing that binds a document to the workspace it came from travels: no
 * access-control lists, connector links, credentials, uploader identity,
 * storage keys, or secret-provenance sidecars. {@link toManifestDocument} is
 * the only projection from a stored document onto the manifest, which is what
 * keeps that list closed.
 *
 * Schemas here validate a file format, not an HTTP boundary, so they live with
 * the transfer code rather than under `lib/api/contracts`. A manifest is
 * untrusted input on import, so every free-text field carries a ceiling even
 * where the stored column has none: the domain caps below are reused where one
 * exists, and {@link MAX_BUNDLE_TEXT_LENGTH} bounds the rest.
 */

import { z } from 'zod'
import { chunkingConfigSchema } from '@/lib/api/contracts/knowledge/base'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { KB_EMBEDDING_STORAGE_DIMENSIONS } from '@/lib/embeddings/catalog'
import {
  ALL_TAG_SLOTS,
  type AllTagSlot,
  isValidSlotForFieldType,
  KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
  KNOWLEDGE_BUNDLE_VERSION,
  KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH,
  MAX_KNOWLEDGE_BUNDLE_CHUNK_CONTENT_LENGTH,
  MAX_KNOWLEDGE_BUNDLE_DOCUMENTS,
  SUPPORTED_FIELD_TYPES,
} from '@/lib/knowledge/constants'
import { MAX_DOCUMENT_CHUNKS } from '@/lib/knowledge/documents/document-processing-error'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { safeZipLeafName } from '@/lib/uploads/zip-entry-path'

export const KNOWLEDGE_BUNDLE_MANIFEST_ENTRY = 'manifest.json'

const BUNDLE_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Longest leaf name a bundle uses, for an entry path or the download name. */
const MAX_BUNDLE_LEAF_NAME_LENGTH = 200

/** Ceiling for names, MIME types, and the embedding model id, which no stored column bounds. */
const MAX_BUNDLE_TEXT_LENGTH = 255

/**
 * Ceiling for one tag value. Uploads cap values at 1,000 characters, but
 * connector-written values have no cap, so the bundle allows the same width as
 * a knowledge base description.
 */
const MAX_BUNDLE_TAG_VALUE_LENGTH = KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH

const tagSlotSchema = z.enum(ALL_TAG_SLOTS)

export const knowledgeBundleTagSchema = z
  .object({
    slot: tagSlotSchema,
    displayName: z.string().trim().min(1).max(KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH),
    fieldType: z.enum(SUPPORTED_FIELD_TYPES),
  })
  .strict()
  .refine((tag) => isValidSlotForFieldType(tag.slot, tag.fieldType), {
    message: 'Tag slot does not belong to its field type',
  })

export const knowledgeBundleDocumentSchema = z
  .object({
    id: z.string().regex(BUNDLE_DOCUMENT_ID_PATTERN, 'Document id must be a short identifier'),
    filename: z.string().min(1).max(MAX_BUNDLE_TEXT_LENGTH),
    mimeType: z.string().min(1).max(MAX_BUNDLE_TEXT_LENGTH),
    fileSize: z.number().int().min(0).max(MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE),
    enabled: z.boolean(),
    tags: z.partialRecord(tagSlotSchema, z.string().max(MAX_BUNDLE_TAG_VALUE_LENGTH)),
    file: z.string().nullable(),
    chunks: z.string().nullable(),
    chunkCount: z.number().int().min(0).max(MAX_DOCUMENT_CHUNKS),
    tokenCount: z.number().int().min(0),
    characterCount: z.number().int().min(0),
  })
  .strict()
  .superRefine((document, ctx) => {
    if (document.file === null && document.chunks === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['file'],
        message: 'Document carries neither a file nor chunks',
      })
    }
    if (document.file !== null && !document.file.startsWith(`files/${document.id}/`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['file'],
        message: 'File entry must live under files/<document id>/',
      })
    }
    if (document.chunks !== null && document.chunks !== chunksEntryPath(document.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['chunks'],
        message: 'Chunks entry must be chunks/<document id>.ndjson',
      })
    }
  })

export const knowledgeBundleManifestSchema = z
  .object({
    version: z.literal(KNOWLEDGE_BUNDLE_VERSION),
    exportedAt: z.iso.datetime(),
    embedding: z
      .object({
        model: z.string().min(1).max(MAX_BUNDLE_TEXT_LENGTH),
        dimension: z.literal(
          KB_EMBEDDING_STORAGE_DIMENSIONS,
          'Embedding dimension has no storage column'
        ),
        vectorsIncluded: z.boolean(),
      })
      .strict(),
    knowledgeBase: z
      .object({
        name: z.string().trim().min(1).max(MAX_BUNDLE_TEXT_LENGTH),
        description: z.string().max(KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH).nullable(),
        chunkingConfig: chunkingConfigSchema,
      })
      .strict(),
    tags: z
      .array(knowledgeBundleTagSchema)
      .max(ALL_TAG_SLOTS.length)
      .superRefine((tags, ctx) => {
        const slots = new Set<string>()
        const names = new Set<string>()
        for (const [index, tag] of tags.entries()) {
          if (slots.has(tag.slot)) {
            ctx.addIssue({ code: 'custom', path: [index, 'slot'], message: 'Duplicate tag slot' })
          }
          const name = tag.displayName.toLowerCase()
          if (names.has(name)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'displayName'],
              message: 'Duplicate tag name',
            })
          }
          slots.add(tag.slot)
          names.add(name)
        }
      }),
    documents: z.array(knowledgeBundleDocumentSchema).max(MAX_KNOWLEDGE_BUNDLE_DOCUMENTS),
  })
  .strict()

export const knowledgeBundleChunkLineSchema = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_DOCUMENT_CHUNKS - 1),
    content: z.string().min(1).max(MAX_KNOWLEDGE_BUNDLE_CHUNK_CONTENT_LENGTH),
    tokenCount: z.number().int().min(0),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(0),
    enabled: z.boolean(),
    vector: z.base64().optional(),
  })
  .strict()

export type KnowledgeBundleManifest = z.output<typeof knowledgeBundleManifestSchema>
export type KnowledgeBundleDocument = KnowledgeBundleManifest['documents'][number]
export type KnowledgeBundleTag = z.output<typeof knowledgeBundleTagSchema>
export type KnowledgeBundleChunkLine = z.output<typeof knowledgeBundleChunkLineSchema>

/** Tag values a stored document row carries, keyed by slot. */
export type KnowledgeBundleTagValues = Partial<
  Record<AllTagSlot, string | number | boolean | Date | null>
>

/** The stored fields the manifest is projected from. */
export interface ExportableDocumentRecord {
  id: string
  filename: string
  mimeType: string
  fileSize: number
  enabled: boolean
  tokenCount: number
  characterCount: number
  tags: KnowledgeBundleTagValues
}

/** Where a document's entries sit inside the bundle. */
export interface KnowledgeBundleEntryPaths {
  file: string | null
  chunks: string | null
}

export function chunksEntryPath(documentId: string): string {
  return `chunks/${documentId}.ndjson`
}

export function fileEntryPath(documentId: string, filename: string): string {
  return `files/${documentId}/${safeBundleLeafName(filename)}`
}

/** Where an exportable document's entries sit inside the bundle, or `null` for entries it does not carry. */
export function bundleEntryPaths(document: {
  id: string
  filename: string
  file: unknown | null
  storedChunkCount: number
}): KnowledgeBundleEntryPaths {
  return {
    file: document.file ? fileEntryPath(document.id, document.filename) : null,
    chunks: document.storedChunkCount > 0 ? chunksEntryPath(document.id) : null,
  }
}

/**
 * Validates an export's stored values against the bundle format before any byte
 * streams, and returns them in their wire shape. The manifest is written last,
 * so a value the import side would reject must surface as a clear error rather
 * than a truncated archive.
 */
export function parseDescribableBundle(manifest: unknown): KnowledgeBundleManifest {
  const result = knowledgeBundleManifestSchema.safeParse(manifest)
  if (result.success) return result.data
  const [issue] = result.error.issues
  throw new OrchestrationError(
    'conflict',
    `Knowledge base cannot be exported: ${issue.path.join('.')} ${issue.message}`
  )
}

/** A filesystem-safe leaf name for a bundle entry or the bundle download itself. */
export function safeBundleLeafName(name: string): string {
  return safeZipLeafName(name).slice(0, MAX_BUNDLE_LEAF_NAME_LENGTH)
}

function tagValueToWire(value: string | number | boolean | Date): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * The one projection from a stored document onto its manifest entry. Any field
 * not named here does not leave in an export.
 */
export function toManifestDocument(
  record: ExportableDocumentRecord,
  entries: KnowledgeBundleEntryPaths,
  chunkCount: number
): KnowledgeBundleDocument {
  const tags: KnowledgeBundleDocument['tags'] = {}
  for (const slot of ALL_TAG_SLOTS) {
    const value = record.tags[slot]
    if (value !== null && value !== undefined) tags[slot] = tagValueToWire(value)
  }
  return {
    id: record.id,
    filename: record.filename,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    enabled: record.enabled,
    tags,
    file: entries.file,
    chunks: entries.chunks,
    chunkCount,
    tokenCount: record.tokenCount,
    characterCount: record.characterCount,
  }
}

/** Serializes a vector as little-endian float32, which is lossless for pgvector's `real` storage. */
export function encodeVectorBase64(vector: readonly number[]): string {
  return Buffer.from(Float32Array.from(vector).buffer).toString('base64')
}

export class KnowledgeBundleVectorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeBundleVectorError'
  }
}

/** Reverses {@link encodeVectorBase64}, refusing any width or value pgvector could not store. */
export function decodeVectorBase64(encoded: string, dimension: number): number[] {
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) {
    throw new KnowledgeBundleVectorError(
      `Vector holds ${bytes.byteLength} bytes; expected ${dimension} float32 values`
    )
  }
  const vector = Array.from(
    new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  )
  if (!vector.every(Number.isFinite)) {
    throw new KnowledgeBundleVectorError('Vector contains a non-finite value')
  }
  return vector
}
