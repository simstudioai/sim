import { db } from '@sim/db'
import {
  document,
  documentSecretProvenance,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import {
  getSlotsForFieldType,
  isValidSlotForFieldType,
  SUPPORTED_FIELD_TYPES,
} from '@/lib/knowledge/constants'
import type { BulkTagDefinitionsData, DocumentTagDefinition } from '@/lib/knowledge/tags/types'
import type {
  CreateTagDefinitionData,
  TagDefinition,
  UpdateTagDefinitionData,
} from '@/lib/knowledge/types'

const logger = createLogger('TagsService')

/** Text tag slots */
const VALID_TEXT_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const

const VALID_NUMBER_SLOTS = ['number1', 'number2', 'number3', 'number4', 'number5'] as const
/** Date tag slots (reduced to 2 for write performance) */
const VALID_DATE_SLOTS = ['date1', 'date2'] as const
/** Boolean tag slots */
const VALID_BOOLEAN_SLOTS = ['boolean1', 'boolean2', 'boolean3'] as const

/** All valid tag slots combined */
const VALID_TAG_SLOTS = [
  ...VALID_TEXT_SLOTS,
  ...VALID_NUMBER_SLOTS,
  ...VALID_DATE_SLOTS,
  ...VALID_BOOLEAN_SLOTS,
] as const

type ValidTagSlot = (typeof VALID_TAG_SLOTS)[number]
type ClearedTagValues = Partial<Record<ValidTagSlot, null>>
const TAG_MUTATION_STATEMENT_TIMEOUT_MS = 120_000
const TAG_MUTATION_LOCK_TIMEOUT_MS = 5_000
const TAG_MUTATION_IDLE_TIMEOUT_MS = 30_000

export class KnowledgeTagProvenanceConflictError extends OrchestrationError {
  constructor() {
    super(
      'conflict',
      'Tag definitions cannot be deleted while resolved-secret document provenance is present'
    )
    this.name = 'KnowledgeTagProvenanceConflictError'
  }
}

/**
 * Validates that a tag slot is a valid slot name
 */
function validateTagSlot(tagSlot: string): asserts tagSlot is ValidTagSlot {
  if (!VALID_TAG_SLOTS.includes(tagSlot as ValidTagSlot)) {
    throw new Error(`Invalid tag slot: ${tagSlot}. Must be one of: ${VALID_TAG_SLOTS.join(', ')}`)
  }
}

/** Applies transaction-scoped bounds that are safe with pooled Postgres connections. */
async function setTagMutationTransactionTimeouts(tx: DbTransaction): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('statement_timeout', ${`${TAG_MUTATION_STATEMENT_TIMEOUT_MS}ms`}, true),
        set_config('lock_timeout', ${`${TAG_MUTATION_LOCK_TIMEOUT_MS}ms`}, true),
        set_config('idle_in_transaction_session_timeout', ${`${TAG_MUTATION_IDLE_TIMEOUT_MS}ms`}, true)`
  )
}

/** Serializes tag deletion with document creation, which locks the same KB row first. */
async function lockKnowledgeBaseForTagMutation(
  tx: DbTransaction,
  knowledgeBaseId: string
): Promise<void> {
  await tx
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)
    .for('update')
}

/** Prevents tag cleanup from demoting nonempty or unverifiable provenance to legacy state. */
async function assertKnowledgeBaseTagsCanBeClearedInTx(
  tx: DbTransaction,
  knowledgeBaseId: string
): Promise<void> {
  const [conflict] = await tx
    .select({ id: document.id })
    .from(document)
    .leftJoin(documentSecretProvenance, eq(documentSecretProvenance.documentId, document.id))
    .where(
      and(
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.secretProvenanceVersion, 1),
        or(
          isNull(documentSecretProvenance.documentId),
          sql`${documentSecretProvenance.status} IS DISTINCT FROM 'exact'`,
          sql`${documentSecretProvenance.entries} <> '[]'::jsonb`
        )
      )
    )
    .limit(1)
    .for('update', { of: document })

  if (conflict) throw new KnowledgeTagProvenanceConflictError()
}

async function clearTagSlotsInTx(
  tx: DbTransaction,
  knowledgeBaseId: string,
  tagSlots: readonly ValidTagSlot[]
): Promise<void> {
  if (tagSlots.length === 0) return

  const clearedTagValues: ClearedTagValues = {}
  for (const tagSlot of tagSlots) clearedTagValues[tagSlot] = null

  await assertKnowledgeBaseTagsCanBeClearedInTx(tx, knowledgeBaseId)

  await tx
    .update(embedding)
    .set(clearedTagValues)
    .where(
      and(
        eq(embedding.knowledgeBaseId, knowledgeBaseId),
        or(...tagSlots.map((tagSlot) => isNotNull(embedding[tagSlot])))
      )
    )

  await tx
    .update(document)
    .set(clearedTagValues)
    .where(
      and(
        eq(document.knowledgeBaseId, knowledgeBaseId),
        or(...tagSlots.map((tagSlot) => isNotNull(document[tagSlot])))
      )
    )
}

/**
 * Get the field type for a tag slot
 */
function getFieldTypeForSlot(tagSlot: string): string | null {
  if ((VALID_TEXT_SLOTS as readonly string[]).includes(tagSlot)) return 'text'
  if ((VALID_NUMBER_SLOTS as readonly string[]).includes(tagSlot)) return 'number'
  if ((VALID_DATE_SLOTS as readonly string[]).includes(tagSlot)) return 'date'
  if ((VALID_BOOLEAN_SLOTS as readonly string[]).includes(tagSlot)) return 'boolean'
  return null
}

/**
 * Get the next available slot for a knowledge base and field type
 */
export async function getNextAvailableSlot(
  knowledgeBaseId: string,
  fieldType: string,
  existingBySlot?: Map<string, { fieldType: string }>
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
 * Normalizes a tag display name for uniqueness comparison.
 *
 * Display names are the user-facing filter keys, so two tags differing only in
 * case are indistinguishable in every surface that reads them. The stored value
 * keeps the caller's casing; only the comparison is case-insensitive.
 */
export function normalizeDisplayName(displayName: string): string {
  return displayName.trim().toLowerCase()
}

/**
 * Declare tag definitions in bulk.
 *
 * The call is declarative and idempotent: a definition that already matches the
 * declaration is reported in `updated` without a write, an explicitly requested
 * `tagSlot` is honored or reported as an error (it is never silently relocated),
 * a slot already held by a differently named tag is a collision rather than a
 * rename (renaming says so through `originalDisplayName`), and a slot whose
 * family does not match `fieldType` is rejected the same way single-tag
 * creation rejects it.
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

  const existingDefinitions = await getDocumentTagDefinitions(knowledgeBaseId)
  const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot, def]))
  const existingByDisplayName = new Map(
    existingDefinitions.map((def) => [normalizeDisplayName(def.displayName), def])
  )

  for (const defData of definitions) {
    try {
      const { tagSlot, displayName, fieldType, originalDisplayName } = defData

      if (!SUPPORTED_FIELD_TYPES.includes(fieldType as (typeof SUPPORTED_FIELD_TYPES)[number])) {
        errors.push(`Invalid field type: ${fieldType}`)
        continue
      }

      const normalizedDisplayName = normalizeDisplayName(displayName)

      const slotOccupant = tagSlot ? existingBySlot.get(tagSlot) : undefined

      /**
       * A definition is identified by its slot when one is declared, and by its
       * display name otherwise. `originalDisplayName` renames the tag that
       * currently carries that name.
       */
      const target = originalDisplayName
        ? existingByDisplayName.get(normalizeDisplayName(originalDisplayName))
        : tagSlot
          ? slotOccupant
          : existingByDisplayName.get(normalizedDisplayName)

      if (originalDisplayName && !target) {
        errors.push(`Tag definition with display name "${originalDisplayName}" not found`)
        continue
      }

      if (tagSlot && !isValidSlotForFieldType(tagSlot, fieldType)) {
        errors.push(`Tag slot "${tagSlot}" is not valid for field type "${fieldType}"`)
        continue
      }

      if (target) {
        /**
         * A declared slot is an identity assertion, never a move order: the tag
         * values already written into the old slot on every document stay where
         * they are, so honouring a relocation would relabel data that never
         * moved.
         */
        if (tagSlot && target.tagSlot !== tagSlot) {
          errors.push(
            `Tag "${target.displayName}" occupies slot "${target.tagSlot}"; a tag's slot cannot change`
          )
          continue
        }

        /**
         * An occupied slot declared with a different name is a collision, not a
         * rename. Document values are keyed by slot and are untouched by a
         * rename, so silently relabelling the occupant would give every document
         * a new label for old data and break saved filters keyed on the old
         * name. A genuine rename says so through `originalDisplayName`.
         */
        if (
          !originalDisplayName &&
          slotOccupant &&
          normalizeDisplayName(slotOccupant.displayName) !== normalizedDisplayName
        ) {
          errors.push(
            `Tag slot "${tagSlot}" is already in use by "${slotOccupant.displayName}"; supply originalDisplayName to rename it`
          )
          continue
        }

        if (target.fieldType !== fieldType) {
          errors.push(
            `Tag "${target.displayName}" occupies slot "${target.tagSlot}", which is not valid for field type "${fieldType}"`
          )
          continue
        }

        const nameOwner = existingByDisplayName.get(normalizedDisplayName)
        if (nameOwner && nameOwner.id !== target.id) {
          errors.push(`Display name "${displayName}" already exists`)
          continue
        }

        if (target.displayName === displayName) {
          updated.push(target)
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
          .where(eq(knowledgeBaseTagDefinitions.id, target.id))

        const renamed: DocumentTagDefinition = {
          id: target.id,
          knowledgeBaseId,
          tagSlot: target.tagSlot,
          displayName,
          fieldType,
          createdAt: target.createdAt,
          updatedAt: now,
        }
        existingBySlot.set(target.tagSlot, renamed)
        existingByDisplayName.delete(normalizeDisplayName(target.displayName))
        existingByDisplayName.set(normalizedDisplayName, renamed)
        updated.push(renamed)
        continue
      }

      if (existingByDisplayName.has(normalizedDisplayName)) {
        errors.push(`Display name "${displayName}" already exists`)
        continue
      }

      let finalTagSlot = tagSlot
      if (!finalTagSlot) {
        const nextSlot = await getNextAvailableSlot(knowledgeBaseId, fieldType, existingBySlot)
        if (!nextSlot) {
          errors.push(`No available slots for field type "${fieldType}"`)
          continue
        }
        finalTagSlot = nextSlot
      }

      const newDefinition = {
        id: generateId(),
        knowledgeBaseId,
        tagSlot: finalTagSlot as ValidTagSlot,
        displayName,
        fieldType,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      await db.insert(knowledgeBaseTagDefinitions).values(newDefinition)

      existingBySlot.set(finalTagSlot, newDefinition)
      existingByDisplayName.set(normalizedDisplayName, newDefinition)

      created.push(newDefinition as DocumentTagDefinition)
    } catch (error) {
      errors.push(`Error processing definition "${defData.displayName}": ${getErrorMessage(error)}`)
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
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          sql`${sql.raw(tagSlot)} IS NOT NULL`
        )
      )

    const chunkCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          eq(embedding.knowledgeBaseId, knowledgeBaseId),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          sql`${sql.raw(`embedding.${tagSlot}`)} IS NOT NULL`
        )
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
  const deletedCount = await db.transaction(async (tx) => {
    await setTagMutationTransactionTimeouts(tx)
    await lockKnowledgeBaseForTagMutation(tx, knowledgeBaseId)

    const definitions = await tx
      .select({ id: knowledgeBaseTagDefinitions.id, tagSlot: knowledgeBaseTagDefinitions.tagSlot })
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))
      .for('update')
    const tagSlots = definitions.map((definition) => {
      const tagSlot = definition.tagSlot as string
      validateTagSlot(tagSlot)
      return tagSlot
    })

    await clearTagSlotsInTx(tx, knowledgeBaseId, tagSlots)

    await tx
      .delete(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    return definitions.length
  })

  logger.info(`[${requestId}] Deleted ${deletedCount} tag definitions for KB: ${knowledgeBaseId}`)

  return deletedCount
}

/**
 * Delete a tag definition with comprehensive cleanup
 * This removes the definition and clears all document/chunk references
 */
export async function deleteTagDefinition(
  knowledgeBaseId: string,
  tagDefinitionId: string,
  requestId: string
): Promise<{ tagSlot: string; displayName: string }> {
  const definition = await db.transaction(async (tx) => {
    await setTagMutationTransactionTimeouts(tx)
    await lockKnowledgeBaseForTagMutation(tx, knowledgeBaseId)

    const [tagDef] = await tx
      .select({
        id: knowledgeBaseTagDefinitions.id,
        knowledgeBaseId: knowledgeBaseTagDefinitions.knowledgeBaseId,
        tagSlot: knowledgeBaseTagDefinitions.tagSlot,
        displayName: knowledgeBaseTagDefinitions.displayName,
      })
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.id, tagDefinitionId),
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId)
        )
      )
      .limit(1)
      .for('update')
    if (!tagDef) throw new Error(`Tag definition ${tagDefinitionId} not found`)

    const tagSlot = tagDef.tagSlot as string
    validateTagSlot(tagSlot)
    await clearTagSlotsInTx(tx, tagDef.knowledgeBaseId, [tagSlot])

    await tx
      .delete(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.id, tagDefinitionId))

    return tagDef
  })

  const tagSlot = definition.tagSlot as string

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
  requestId: string,
  txDb?: DbOrTx
): Promise<TagDefinition> {
  const dbInstance = txDb ?? db
  const tagDefinitionId = generateId()
  const now = new Date()

  const newDefinition = {
    id: tagDefinitionId,
    knowledgeBaseId: data.knowledgeBaseId,
    tagSlot: data.tagSlot as ValidTagSlot,
    displayName: data.displayName,
    fieldType: data.fieldType,
    createdAt: now,
    updatedAt: now,
  }

  await dbInstance.insert(knowledgeBaseTagDefinitions).values(newDefinition)

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

    // Text columns need both IS NOT NULL and != '' checks
    // Numeric/date/boolean columns only need IS NOT NULL
    const fieldType = getFieldTypeForSlot(tagSlot)
    const isTextColumn = fieldType === 'text'

    const whereConditions = [
      eq(document.knowledgeBaseId, knowledgeBaseId),
      eq(document.userExcluded, false),
      isNull(document.archivedAt),
      isNull(document.deletedAt),
      isNotNull(sql`${sql.raw(tagSlot)}`),
    ]

    if (isTextColumn) {
      whereConditions.push(sql`${sql.raw(tagSlot)} != ''`)
    }

    const documentsWithTag = await db
      .select({
        id: document.id,
        filename: document.filename,
        tagValue: sql<string>`${sql.raw(tagSlot)}::text`,
      })
      .from(document)
      .where(and(...whereConditions))

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
    id: string
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
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          sql`${sql.raw(tagSlot)} IS NOT NULL`
        )
      )

    const chunkCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          eq(embedding.knowledgeBaseId, knowledgeBaseId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          sql`${sql.raw(`embedding.${tagSlot}`)} IS NOT NULL`
        )
      )

    stats.push({
      id: def.id,
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
