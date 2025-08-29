import { randomUUID } from 'crypto'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  getSlotsForFieldType,
  SUPPORTED_FIELD_TYPES,
  type TAG_SLOT_CONFIG,
} from '@/lib/constants/knowledge'
import type { BulkTagDefinitionsData, DocumentTagDefinition } from '@/lib/knowledge/tags/types'
import type {
  CreateTagDefinitionData,
  TagDefinition,
  UpdateTagDefinitionData,
} from '@/lib/knowledge/types'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { document, embedding, knowledgeBaseTagDefinitions } from '@/db/schema'

const logger = createLogger('TagsService')

const VALID_TAG_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const

function validateTagSlot(tagSlot: string): asserts tagSlot is (typeof VALID_TAG_SLOTS)[number] {
  if (!VALID_TAG_SLOTS.includes(tagSlot as (typeof VALID_TAG_SLOTS)[number])) {
    throw new Error(`Invalid tag slot: ${tagSlot}. Must be one of: ${VALID_TAG_SLOTS.join(', ')}`)
  }
}

/**
 * Get the next available slot for a knowledge base and field type
 */
export async function getNextAvailableSlot(
  knowledgeBaseId: string,
  fieldType: string,
  existingBySlot?: Map<string, any>
): Promise<string | null> {
  const availableSlots = getSlotsForFieldType(fieldType)
  let usedSlots: Set<string>

  if (existingBySlot) {
    usedSlots = new Set(
      Array.from(existingBySlot.entries())
        .filter(([_, def]) => def.fieldType === fieldType)
        .map(([slot, _]) => slot)
    )
  } else {
    const existingDefinitions = await db
      .select({ tagSlot: knowledgeBaseTagDefinitions.tagSlot })
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseTagDefinitions.fieldType, fieldType)
        )
      )

    usedSlots = new Set(existingDefinitions.map((def) => def.tagSlot))
  }

  for (const slot of availableSlots) {
    if (!usedSlots.has(slot)) {
      return slot
    }
  }

  return null // All slots for this field type are used
}

/**
 * Get all tag definitions for a knowledge base
 */
export async function getDocumentTagDefinitions(
  knowledgeBaseId: string
): Promise<DocumentTagDefinition[]> {
  const definitions = await db
    .select({
      id: knowledgeBaseTagDefinitions.id,
      knowledgeBaseId: knowledgeBaseTagDefinitions.knowledgeBaseId,
      tagSlot: knowledgeBaseTagDefinitions.tagSlot,
      displayName: knowledgeBaseTagDefinitions.displayName,
      fieldType: knowledgeBaseTagDefinitions.fieldType,
      createdAt: knowledgeBaseTagDefinitions.createdAt,
      updatedAt: knowledgeBaseTagDefinitions.updatedAt,
    })
    .from(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))
    .orderBy(knowledgeBaseTagDefinitions.tagSlot)

  return definitions.map((def) => ({
    ...def,
    tagSlot: def.tagSlot as string,
  }))
}

/**
 * Get all tag definitions for a knowledge base (alias for compatibility)
 */
export async function getTagDefinitions(knowledgeBaseId: string): Promise<TagDefinition[]> {
  const tagDefinitions = await db
    .select({
      id: knowledgeBaseTagDefinitions.id,
      tagSlot: knowledgeBaseTagDefinitions.tagSlot,
      displayName: knowledgeBaseTagDefinitions.displayName,
      fieldType: knowledgeBaseTagDefinitions.fieldType,
      createdAt: knowledgeBaseTagDefinitions.createdAt,
      updatedAt: knowledgeBaseTagDefinitions.updatedAt,
    })
    .from(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))
    .orderBy(knowledgeBaseTagDefinitions.tagSlot)

  return tagDefinitions.map((def) => ({
    ...def,
    tagSlot: def.tagSlot as string,
  }))
}

/**
 * Create or update tag definitions in bulk
 */
export async function createOrUpdateTagDefinitionsBulk(
  knowledgeBaseId: string,
  bulkData: BulkTagDefinitionsData,
  requestId: string
): Promise<{
  created: DocumentTagDefinition[]
  updated: DocumentTagDefinition[]
  errors: string[]
}> {
  const { definitions } = bulkData
  const created: DocumentTagDefinition[] = []
  const updated: DocumentTagDefinition[] = []
  const errors: string[] = []

  // Get existing definitions to check for conflicts and determine operations
  const existingDefinitions = await getDocumentTagDefinitions(knowledgeBaseId)
  const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot, def]))
  const existingByDisplayName = new Map(existingDefinitions.map((def) => [def.displayName, def]))

  // Process each definition
  for (const defData of definitions) {
    try {
      const { tagSlot, displayName, fieldType, originalDisplayName } = defData

      // Validate field type
      if (!SUPPORTED_FIELD_TYPES.includes(fieldType as (typeof SUPPORTED_FIELD_TYPES)[number])) {
        errors.push(`Invalid field type: ${fieldType}`)
        continue
      }

      // Check if this is an update (has originalDisplayName) or create
      const isUpdate = !!originalDisplayName

      if (isUpdate) {
        // Update existing definition
        const existingDef = existingByDisplayName.get(originalDisplayName!)
        if (!existingDef) {
          errors.push(`Tag definition with display name "${originalDisplayName}" not found`)
          continue
        }

        // Check if new display name conflicts with another definition
        if (displayName !== originalDisplayName && existingByDisplayName.has(displayName)) {
          errors.push(`Display name "${displayName}" already exists`)
          continue
        }

        const now = new Date()
        await db
          .update(knowledgeBaseTagDefinitions)
          .set({
            displayName,
            fieldType,
            updatedAt: now,
          })
          .where(eq(knowledgeBaseTagDefinitions.id, existingDef.id))

        updated.push({
          id: existingDef.id,
          knowledgeBaseId,
          tagSlot: existingDef.tagSlot,
          displayName,
          fieldType,
          createdAt: existingDef.createdAt,
          updatedAt: now,
        })
      } else {
        // Create new definition
        let finalTagSlot = tagSlot

        // If no slot provided or slot is taken, find next available
        if (!finalTagSlot || existingBySlot.has(finalTagSlot)) {
          const nextSlot = await getNextAvailableSlot(knowledgeBaseId, fieldType, existingBySlot)
          if (!nextSlot) {
            errors.push(`No available slots for field type "${fieldType}"`)
            continue
          }
          finalTagSlot = nextSlot
        }

        // Check slot conflicts
        if (existingBySlot.has(finalTagSlot)) {
          errors.push(`Tag slot "${finalTagSlot}" is already in use`)
          continue
        }

        // Check display name conflicts
        if (existingByDisplayName.has(displayName)) {
          errors.push(`Display name "${displayName}" already exists`)
          continue
        }

        const id = randomUUID()
        const now = new Date()

        const newDefinition = {
          id,
          knowledgeBaseId,
          tagSlot: finalTagSlot as (typeof TAG_SLOT_CONFIG.text.slots)[number],
          displayName,
          fieldType,
          createdAt: now,
          updatedAt: now,
        }

        await db.insert(knowledgeBaseTagDefinitions).values(newDefinition)

        // Add to maps to track for subsequent definitions in this batch
        existingBySlot.set(finalTagSlot, newDefinition)
        existingByDisplayName.set(displayName, newDefinition)

        created.push(newDefinition as DocumentTagDefinition)
      }
    } catch (error) {
      errors.push(`Error processing definition "${defData.displayName}": ${error}`)
    }
  }

  logger.info(
    `[${requestId}] Bulk tag definitions processed: ${created.length} created, ${updated.length} updated, ${errors.length} errors`
  )

  return { created, updated, errors }
}

/**
 * Get a single tag definition by ID
 */
export async function getTagDefinitionById(
  tagDefinitionId: string
): Promise<DocumentTagDefinition | null> {
  const result = await db
    .select({
      id: knowledgeBaseTagDefinitions.id,
      knowledgeBaseId: knowledgeBaseTagDefinitions.knowledgeBaseId,
      tagSlot: knowledgeBaseTagDefinitions.tagSlot,
      displayName: knowledgeBaseTagDefinitions.displayName,
      fieldType: knowledgeBaseTagDefinitions.fieldType,
      createdAt: knowledgeBaseTagDefinitions.createdAt,
      updatedAt: knowledgeBaseTagDefinitions.updatedAt,
    })
    .from(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.id, tagDefinitionId))
    .limit(1)

  if (result.length === 0) {
    return null
  }

  const def = result[0]
  return {
    ...def,
    tagSlot: def.tagSlot as string,
  }
}

/**
 * Update tags on all documents and chunks when a tag value is changed
 */
export async function updateTagValuesInDocumentsAndChunks(
  knowledgeBaseId: string,
  tagSlot: string,
  oldValue: string | null,
  newValue: string | null,
  requestId: string
): Promise<{ documentsUpdated: number; chunksUpdated: number }> {
  validateTagSlot(tagSlot)

  let documentsUpdated = 0
  let chunksUpdated = 0

  await db.transaction(async (tx) => {
    if (oldValue) {
      await tx
        .update(document)
        .set({
          [tagSlot]: newValue,
        })
        .where(
          and(
            eq(document.knowledgeBaseId, knowledgeBaseId),
            eq(sql.raw(`${document}.${tagSlot}`), oldValue)
          )
        )
      documentsUpdated = 1
    }

    if (oldValue) {
      await tx
        .update(embedding)
        .set({
          [tagSlot]: newValue,
        })
        .where(
          and(
            eq(embedding.knowledgeBaseId, knowledgeBaseId),
            eq(sql.raw(`${embedding}.${tagSlot}`), oldValue)
          )
        )
      chunksUpdated = 1
    }
  })

  logger.info(
    `[${requestId}] Updated tag values: ${documentsUpdated} documents, ${chunksUpdated} chunks`
  )

  return { documentsUpdated, chunksUpdated }
}

/**
 * Cleanup unused tag definitions for a knowledge base
 */
export async function cleanupUnusedTagDefinitions(
  knowledgeBaseId: string,
  requestId: string
): Promise<number> {
  const definitions = await getDocumentTagDefinitions(knowledgeBaseId)
  let cleanedUp = 0

  for (const def of definitions) {
    const tagSlot = def.tagSlot
    validateTagSlot(tagSlot)

    const docCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(document)
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          isNull(document.deletedAt),
          sql`${sql.raw(tagSlot)} IS NOT NULL`
        )
      )

    const chunkCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(embedding)
      .where(
        and(eq(embedding.knowledgeBaseId, knowledgeBaseId), sql`${sql.raw(tagSlot)} IS NOT NULL`)
      )

    const docCount = Number(docCountResult[0]?.count || 0)
    const chunkCount = Number(chunkCountResult[0]?.count || 0)

    if (docCount === 0 && chunkCount === 0) {
      await db.delete(knowledgeBaseTagDefinitions).where(eq(knowledgeBaseTagDefinitions.id, def.id))

      cleanedUp++
      logger.info(
        `[${requestId}] Cleaned up unused tag definition: ${def.displayName} (${def.tagSlot})`
      )
    }
  }

  logger.info(`[${requestId}] Cleanup completed: ${cleanedUp} unused tag definitions removed`)
  return cleanedUp
}

/**
 * Delete all tag definitions for a knowledge base
 */
export async function deleteAllTagDefinitions(
  knowledgeBaseId: string,
  requestId: string
): Promise<number> {
  const result = await db
    .delete(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))
    .returning({ id: knowledgeBaseTagDefinitions.id })

  const deletedCount = result.length
  logger.info(`[${requestId}] Deleted ${deletedCount} tag definitions for KB: ${knowledgeBaseId}`)

  return deletedCount
}

/**
 * Delete a tag definition with comprehensive cleanup
 * This removes the definition and clears all document/chunk references
 */
export async function deleteTagDefinition(
  tagDefinitionId: string,
  requestId: string
): Promise<{ tagSlot: string; displayName: string }> {
  const tagDef = await db
    .select({
      id: knowledgeBaseTagDefinitions.id,
      knowledgeBaseId: knowledgeBaseTagDefinitions.knowledgeBaseId,
      tagSlot: knowledgeBaseTagDefinitions.tagSlot,
      displayName: knowledgeBaseTagDefinitions.displayName,
    })
    .from(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.id, tagDefinitionId))
    .limit(1)

  if (tagDef.length === 0) {
    throw new Error(`Tag definition ${tagDefinitionId} not found`)
  }

  const definition = tagDef[0]
  const knowledgeBaseId = definition.knowledgeBaseId
  const tagSlot = definition.tagSlot as string

  validateTagSlot(tagSlot)

  await db.transaction(async (tx) => {
    await tx
      .update(document)
      .set({ [tagSlot]: null })
      .where(
        and(eq(document.knowledgeBaseId, knowledgeBaseId), isNotNull(sql`${sql.raw(tagSlot)}`))
      )

    await tx
      .update(embedding)
      .set({ [tagSlot]: null })
      .where(
        and(eq(embedding.knowledgeBaseId, knowledgeBaseId), isNotNull(sql`${sql.raw(tagSlot)}`))
      )

    await tx
      .delete(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.id, tagDefinitionId))
  })

  logger.info(
    `[${requestId}] Deleted tag definition with cleanup: ${definition.displayName} (${tagSlot})`
  )

  return {
    tagSlot,
    displayName: definition.displayName,
  }
}

/**
 * Create a new tag definition
 */
export async function createTagDefinition(
  data: CreateTagDefinitionData,
  requestId: string
): Promise<TagDefinition> {
  const tagDefinitionId = randomUUID()
  const now = new Date()

  const newDefinition = {
    id: tagDefinitionId,
    knowledgeBaseId: data.knowledgeBaseId,
    tagSlot: data.tagSlot as (typeof TAG_SLOT_CONFIG.text.slots)[number],
    displayName: data.displayName,
    fieldType: data.fieldType,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(knowledgeBaseTagDefinitions).values(newDefinition)

  logger.info(
    `[${requestId}] Created tag definition: ${data.displayName} -> ${data.tagSlot} in KB ${data.knowledgeBaseId}`
  )

  return {
    id: tagDefinitionId,
    tagSlot: data.tagSlot,
    displayName: data.displayName,
    fieldType: data.fieldType,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Update an existing tag definition
 */
export async function updateTagDefinition(
  tagDefinitionId: string,
  data: UpdateTagDefinitionData,
  requestId: string
): Promise<TagDefinition> {
  const now = new Date()

  const updateData: {
    updatedAt: Date
    displayName?: string
    fieldType?: string
  } = {
    updatedAt: now,
  }

  if (data.displayName !== undefined) {
    updateData.displayName = data.displayName
  }

  if (data.fieldType !== undefined) {
    updateData.fieldType = data.fieldType
  }

  const updatedRows = await db
    .update(knowledgeBaseTagDefinitions)
    .set(updateData)
    .where(eq(knowledgeBaseTagDefinitions.id, tagDefinitionId))
    .returning({
      id: knowledgeBaseTagDefinitions.id,
      tagSlot: knowledgeBaseTagDefinitions.tagSlot,
      displayName: knowledgeBaseTagDefinitions.displayName,
      fieldType: knowledgeBaseTagDefinitions.fieldType,
      createdAt: knowledgeBaseTagDefinitions.createdAt,
      updatedAt: knowledgeBaseTagDefinitions.updatedAt,
    })

  if (updatedRows.length === 0) {
    throw new Error(`Tag definition ${tagDefinitionId} not found`)
  }

  const updated = updatedRows[0]
  logger.info(`[${requestId}] Updated tag definition: ${tagDefinitionId}`)

  return {
    ...updated,
    tagSlot: updated.tagSlot as string,
  }
}

/**
 * Get tag usage with detailed document information (original format)
 */
export async function getTagUsage(
  knowledgeBaseId: string,
  requestId = 'api'
): Promise<
  Array<{
    tagName: string
    tagSlot: string
    documentCount: number
    documents: Array<{ id: string; name: string; tagValue: string }>
  }>
> {
  const definitions = await getDocumentTagDefinitions(knowledgeBaseId)
  const usage = []

  for (const def of definitions) {
    const tagSlot = def.tagSlot
    validateTagSlot(tagSlot)

    const documentsWithTag = await db
      .select({
        id: document.id,
        filename: document.filename,
        tagValue: sql<string>`${sql.raw(tagSlot)}`,
      })
      .from(document)
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          isNull(document.deletedAt),
          isNotNull(sql`${sql.raw(tagSlot)}`)
        )
      )

    usage.push({
      tagName: def.displayName,
      tagSlot: def.tagSlot,
      documentCount: documentsWithTag.length,
      documents: documentsWithTag.map((doc) => ({
        id: doc.id,
        name: doc.filename,
        tagValue: doc.tagValue || '',
      })),
    })
  }

  logger.info(`[${requestId}] Retrieved detailed tag usage for ${usage.length} definitions`)

  return usage
}

/**
 * Get tag usage statistics
 */
export async function getTagUsageStats(
  knowledgeBaseId: string,
  requestId: string
): Promise<
  Array<{
    tagSlot: string
    displayName: string
    fieldType: string
    documentCount: number
    chunkCount: number
  }>
> {
  const definitions = await getDocumentTagDefinitions(knowledgeBaseId)
  const stats = []

  for (const def of definitions) {
    const tagSlot = def.tagSlot
    validateTagSlot(tagSlot)

    const docCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(document)
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          isNull(document.deletedAt),
          sql`${sql.raw(tagSlot)} IS NOT NULL`
        )
      )

    const chunkCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(embedding)
      .where(
        and(eq(embedding.knowledgeBaseId, knowledgeBaseId), sql`${sql.raw(tagSlot)} IS NOT NULL`)
      )

    stats.push({
      tagSlot: def.tagSlot,
      displayName: def.displayName,
      fieldType: def.fieldType,
      documentCount: Number(docCountResult[0]?.count || 0),
      chunkCount: Number(chunkCountResult[0]?.count || 0),
    })
  }

  logger.info(`[${requestId}] Retrieved tag usage stats for ${stats.length} definitions`)

  return stats
}
