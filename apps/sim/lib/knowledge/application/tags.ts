import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveActiveKnowledgeResourceContext,
  resolveActiveKnowledgeTagContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  getFieldTypeForSlot,
  isValidSlotForFieldType,
  SUPPORTED_FIELD_TYPES,
  TAG_SLOT_CONFIG,
} from '@/lib/knowledge/constants'
import {
  cleanupUnusedTagDefinitions,
  createOrUpdateTagDefinitionsBulk,
  createTagDefinition,
  deleteAllTagDefinitions,
  deleteTagDefinition,
  getDocumentTagDefinitions,
  getNextAvailableSlot,
  getTagDefinitions,
  getTagUsage,
  getTagUsageStats,
  normalizeDisplayName,
  updateTagDefinition,
} from '@/lib/knowledge/tags/service'
import type { BulkTagDefinitionsData } from '@/lib/knowledge/tags/types'
import type { TagDefinition, UpdateTagDefinitionData } from '@/lib/knowledge/types'

export interface ListKnowledgeTagsInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
}

export interface CreateKnowledgeTagInput extends ListKnowledgeTagsInput {
  tagSlot?: string
  displayName: string
  fieldType?: string
  source?: string
}

export interface UpdateKnowledgeTagInput {
  tagDefinitionId: string
  /**
   * Knowledge base the caller addressed the definition through. Supplying it
   * makes {@link resolveActiveKnowledgeTagContext} 404 a definition that lives
   * in a sibling base, which is what a nested route path asserts.
   */
  knowledgeBaseId?: string
  assertedWorkspaceId?: string
  updates: UpdateTagDefinitionData
  source?: string
}

export interface DeleteKnowledgeTagInput extends ListKnowledgeTagsInput {
  tagDefinitionId: string
  source?: string
}

export interface ReadNextKnowledgeTagSlotInput extends ListKnowledgeTagsInput {
  fieldType: string
}

export interface KnowledgeDocumentTagDefinitionsInput extends ListKnowledgeTagsInput {
  documentId: string
}

/**
 * Bulk vocabulary upsert.
 *
 * Knowledge-base scoped, like the rows it writes. `documentId` is accepted and
 * ignored: the legacy internal route still addresses this write through
 * `/api/knowledge/{id}/documents/{documentId}/tag-definitions`, a path that names
 * a document the write never reads.
 */
export interface SaveKnowledgeDocumentTagDefinitionsInput extends ListKnowledgeTagsInput {
  documentId?: string
  definitions: BulkTagDefinitionsData['definitions']
}

export interface DeleteKnowledgeDocumentTagDefinitionsInput extends ListKnowledgeTagsInput {
  documentId?: string
  /** `cleanup` removes only definitions no document still uses; `all` removes every one. */
  action?: 'cleanup' | 'all'
}

/** The two unique indexes on `knowledge_base_tag_definitions`, by name. */
const TAG_SLOT_UNIQUE_INDEX = 'kb_tag_definitions_kb_slot_idx'
const TAG_DISPLAY_NAME_UNIQUE_INDEX = 'kb_tag_definitions_kb_display_name_idx'

/**
 * Reports a tag uniqueness violation as a conflict rather than a fault.
 *
 * Slot occupancy is not checked before the write: `tagSlot` is a caller
 * parameter and the next-free-slot search only runs when it is omitted, so a
 * caller naming an occupied slot reaches the index directly. Display-name
 * uniqueness is checked, but under the knowledge base's row lock inside the
 * writing transaction rather than here — the pre-checks below are only an early
 * rejection, and the index remains the backstop for an exact-case duplicate
 * racing in through a path that does not take that lock.
 *
 * The index name distinguishes the two so the message says which value to
 * change. Anything else propagates — a foreign-key or not-null violation is a
 * real fault and must not be reported as the caller's conflict.
 */
function tagUniquenessConflict(error: unknown): never {
  if (getPostgresErrorCode(error) === '23505') {
    const constraint = getPostgresConstraintName(error)
    if (constraint === TAG_SLOT_UNIQUE_INDEX) {
      throw new OrchestrationError(
        'conflict',
        'That tag slot is already in use in this knowledge base; omit tagSlot to take the next free one.'
      )
    }
    if (constraint === TAG_DISPLAY_NAME_UNIQUE_INDEX) {
      throw new OrchestrationError(
        'conflict',
        'A tag with that name already exists in this knowledge base'
      )
    }
    throw new OrchestrationError(
      'conflict',
      'That tag conflicts with one that already exists in this knowledge base'
    )
  }
  throw error
}

export const listKnowledgeTags = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listTags,
  resolveContext: ({ principal, input }: { principal: Principal; input: ListKnowledgeTagsInput }) =>
    resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ context }) {
    return { tagDefinitions: await getDocumentTagDefinitions(context.knowledgeBaseId) }
  },
})

export const createKnowledgeTag = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createTag,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateKnowledgeTagInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ input, context }): Promise<{
    tagDefinition: TagDefinition
    knowledgeBaseId: string
  }> {
    const fieldType = input.fieldType ?? 'text'
    if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(fieldType)) {
      throw new OrchestrationError('validation', 'Invalid field type')
    }
    const existingDefinitions = await getDocumentTagDefinitions(context.knowledgeBaseId)
    /**
     * The unique index on display name is case-sensitive, so it lets through
     * names that differ only in case. Two such tags are indistinguishable in
     * every surface that filters by name, so reject them.
     *
     * This is the early rejection, off the read this path already needed for
     * slot allocation. It is not what makes the rule hold — a read here and the
     * insert that depends on it are separate statements, so the authoritative
     * check runs again inside `createTagDefinition`, under the row lock that
     * serializes it against every competing writer.
     */
    if (
      existingDefinitions.some(
        (definition) =>
          normalizeDisplayName(definition.displayName) === normalizeDisplayName(input.displayName)
      )
    ) {
      throw new OrchestrationError(
        'conflict',
        'A tag with that name already exists in this knowledge base'
      )
    }
    const existingBySlot = new Map(
      existingDefinitions.map((definition) => [definition.tagSlot, definition])
    )
    const tagSlot =
      input.tagSlot ??
      (await getNextAvailableSlot(context.knowledgeBaseId, fieldType, existingBySlot))
    if (!tagSlot) {
      throw new OrchestrationError(
        'validation',
        `No available slots for field type "${fieldType}". Maximum tags of this type reached.`
      )
    }
    if (!isValidSlotForFieldType(tagSlot, fieldType)) {
      throw new OrchestrationError(
        'validation',
        `Tag slot "${tagSlot}" is not valid for field type "${fieldType}"`
      )
    }
    const tagDefinition = await createTagDefinition(
      {
        knowledgeBaseId: context.knowledgeBaseId,
        tagSlot,
        displayName: input.displayName,
        fieldType,
      },
      generateRequestId()
    ).catch(tagUniquenessConflict)
    return { tagDefinition, knowledgeBaseId: context.knowledgeBaseId }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: context.knowledgeBaseId,
    resourceName: context.knowledgeBase.name,
    description: `Created tag "${result.tagDefinition.displayName}" in knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      change: 'tag_created',
      tagDefinitionId: result.tagDefinition.id,
      tagSlot: result.tagDefinition.tagSlot,
      fieldType: result.tagDefinition.fieldType,
    },
  }),
})

export const updateKnowledgeTag = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateTag,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateKnowledgeTagInput
  }) => resolveActiveKnowledgeTagContext(input, principal),
  async execute({ input, context }): Promise<{
    tagDefinition: TagDefinition
    knowledgeBaseId: string
  }> {
    if (input.updates.displayName === undefined && input.updates.fieldType === undefined) {
      throw new OrchestrationError('validation', 'No tag updates specified')
    }

    /**
     * A tag's slot is fixed for its lifetime, and each slot only holds one kind
     * of value — so changing `fieldType` is only meaningful when the new type is
     * valid for the slot the definition already occupies. Create checks this;
     * update did not, so a tag in a text slot could be relabelled `number` and
     * every read of it would then interpret text as the wrong type. The same
     * two checks as create, in the same order.
     */
    /**
     * A rename reaches the same case-sensitive display-name index create does,
     * so it can land `CLITEST-CAT` beside an existing `clitest-cat` — the state
     * create rejects. The same check, against the definitions of the same
     * knowledge base, excluding the one being renamed, and — like create's — an
     * early rejection whose authoritative repeat runs under the row lock in
     * `updateTagDefinition`.
     */
    const { displayName } = input.updates
    if (displayName !== undefined) {
      const existingDefinitions = await getDocumentTagDefinitions(context.knowledgeBaseId)
      if (
        existingDefinitions.some(
          (definition) =>
            definition.id !== context.tagDefinitionId &&
            normalizeDisplayName(definition.displayName) === normalizeDisplayName(displayName)
        )
      ) {
        throw new OrchestrationError(
          'conflict',
          'A tag with that name already exists in this knowledge base'
        )
      }
    }

    const { fieldType } = input.updates
    if (fieldType !== undefined) {
      if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(fieldType)) {
        throw new OrchestrationError('validation', 'Invalid field type')
      }
      const tagSlot = context.tagDefinition.tagSlot
      if (!isValidSlotForFieldType(tagSlot, fieldType)) {
        throw new OrchestrationError(
          'validation',
          `Tag slot "${tagSlot}" is not valid for field type "${fieldType}"; a tag's slot cannot change, so create a new tag of that type instead`
        )
      }
    }

    return {
      tagDefinition: await updateTagDefinition(
        context.tagDefinitionId,
        context.knowledgeBaseId,
        input.updates,
        generateRequestId()
      ).catch(tagUniquenessConflict),
      knowledgeBaseId: context.knowledgeBaseId,
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: context.knowledgeBaseId,
    resourceName: context.knowledgeBase.name,
    description: `Updated tag "${result.tagDefinition.displayName}" in knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      change: 'tag_updated',
      tagDefinitionId: result.tagDefinition.id,
      updatedFields: Object.keys(input.updates).filter(
        (key) => input.updates[key as keyof UpdateTagDefinitionData] !== undefined
      ),
    },
  }),
})

export const deleteKnowledgeTag = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteTag,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: DeleteKnowledgeTagInput
  }) => resolveActiveKnowledgeTagContext(input, principal),
  async execute({ context }) {
    const deleted = await deleteTagDefinition(
      context.knowledgeBaseId,
      context.tagDefinitionId,
      generateRequestId()
    )
    return { ...deleted, tagDefinitionId: context.tagDefinitionId }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: context.knowledgeBaseId,
    resourceName: context.knowledgeBase.name,
    description: `Deleted tag "${result.displayName}" from knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      change: 'tag_deleted',
      tagDefinitionId: result.tagDefinitionId,
      tagSlot: result.tagSlot,
    },
  }),
})

export const readKnowledgeTagUsage = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readTagUsage,
  resolveContext: ({ principal, input }: { principal: Principal; input: ListKnowledgeTagsInput }) =>
    resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ context }) {
    return { usage: await getTagUsageStats(context.knowledgeBaseId, generateRequestId()) }
  },
})

export const readDetailedKnowledgeTagUsage = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDetailedTagUsage,
  resolveContext: ({ principal, input }: { principal: Principal; input: ListKnowledgeTagsInput }) =>
    resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ context }) {
    return {
      usage: await getTagUsage(
        context.knowledgeBaseId,
        generateRequestId(),
        await context.access.get()
      ),
    }
  },
})

export const readNextKnowledgeTagSlot = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readNextTagSlot,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadNextKnowledgeTagSlotInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ input, context }) {
    const fieldType = SUPPORTED_FIELD_TYPES.find((supported) => supported === input.fieldType)
    if (!fieldType) {
      throw new OrchestrationError('validation', 'Invalid field type')
    }
    const existingDefinitions = await getTagDefinitions(context.knowledgeBaseId)
    const usedSlots = existingDefinitions
      .filter((definition) => definition.fieldType === fieldType)
      .map((definition) => definition.tagSlot)
    const existingBySlot = new Map(
      existingDefinitions.map((definition) => [definition.tagSlot, definition])
    )
    const nextAvailableSlot = await getNextAvailableSlot(
      context.knowledgeBaseId,
      fieldType,
      existingBySlot
    )
    /**
     * Capacity is per field type, not the text capacity for all four:
     * `TAG_SLOT_CONFIG` gives text 7 slots but number 5, boolean 3, and date 2,
     * so a fixed 7 overstated both the total and what remains on the other
     * three.
     */
    const { maxSlots } = TAG_SLOT_CONFIG[fieldType]
    return {
      nextAvailableSlot,
      fieldType,
      usedSlots,
      totalSlots: maxSlots,
      availableSlots: nextAvailableSlot ? maxSlots - usedSlots.length : 0,
    }
  },
})

export const listKnowledgeDocumentTagDefinitions = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listTags,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: KnowledgeDocumentTagDefinitionsInput
  }) => resolveCanonicalActiveKnowledgeDocumentContext(input, principal),
  async execute({ context }) {
    return { tagDefinitions: await getDocumentTagDefinitions(context.knowledgeBaseId) }
  },
})

/**
 * Creates or updates tag definitions in bulk on the knowledge base.
 *
 * The knowledge base is the canonical context, not a document: every write here
 * lands in `knowledge_base_tag_definitions` keyed by knowledge base and slot, and
 * the audit entry it projects is a `KNOWLEDGE_BASE` one. Tag *values* on one
 * document are written by the document update through its tag slots.
 */
export const saveKnowledgeDocumentTagDefinitions = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.saveDocumentTagDefinitions,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: SaveKnowledgeDocumentTagDefinitionsInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ input, context }) {
    for (const definition of input.definitions) {
      if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(definition.fieldType)) {
        throw new OrchestrationError(
          'validation',
          `Unsupported field type: ${definition.fieldType}`
        )
      }
      if (getFieldTypeForSlot(definition.tagSlot) === null) {
        throw new OrchestrationError('validation', `Unsupported tag slot: ${definition.tagSlot}`)
      }
    }
    return createOrUpdateTagDefinitionsBulk(
      context.knowledgeBaseId,
      { definitions: input.definitions },
      generateRequestId()
    )
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: context.knowledgeBaseId,
    resourceName: context.knowledgeBase.name,
    description: `Updated tag definitions in knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      change: 'document_tag_definitions_saved',
      createdCount: result.created.length,
      updatedCount: result.updated.length,
      errorCount: result.errors.length,
    },
  }),
})

/**
 * Removes tag definitions from the knowledge base — the unused ones, or all of
 * them. Knowledge-base scoped for the same reason the bulk save is: cleanup
 * deletes definitions across the whole vocabulary, not one document's.
 */
export const deleteKnowledgeDocumentTagDefinitions = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteDocumentTagDefinitions,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: DeleteKnowledgeDocumentTagDefinitionsInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ input, context }) {
    if (input.action === 'cleanup') {
      return {
        action: 'cleanup' as const,
        count: await cleanupUnusedTagDefinitions(context.knowledgeBaseId, generateRequestId()),
      }
    }
    return {
      action: 'all' as const,
      count: await deleteAllTagDefinitions(context.knowledgeBaseId, generateRequestId()),
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: context.knowledgeBaseId,
    resourceName: context.knowledgeBase.name,
    description:
      input.action === 'cleanup'
        ? `Cleaned unused tag definitions in knowledge base "${context.knowledgeBase.name}"`
        : `Deleted tag definitions in knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      change: result.action === 'cleanup' ? 'tag_definitions_cleaned' : 'tag_definitions_deleted',
      count: result.count,
    },
  }),
})
