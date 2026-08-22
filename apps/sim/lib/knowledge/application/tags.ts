import { AuditAction, AuditResourceType } from '@sim/audit'
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

export interface SaveKnowledgeDocumentTagDefinitionsInput
  extends KnowledgeDocumentTagDefinitionsInput {
  definitions: BulkTagDefinitionsData['definitions']
}

export interface DeleteKnowledgeDocumentTagDefinitionsInput
  extends KnowledgeDocumentTagDefinitionsInput {
  action?: 'cleanup' | 'all'
}

export const listKnowledgeTags = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listTags,
  resolveContext: ({ input }: { input: ListKnowledgeTagsInput }) =>
    resolveActiveKnowledgeResourceContext(input),
  async execute({ context }) {
    return { tagDefinitions: await getDocumentTagDefinitions(context.knowledgeBaseId) }
  },
})

export const createKnowledgeTag = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createTag,
  resolveContext: ({ input }: { input: CreateKnowledgeTagInput }) =>
    resolveActiveKnowledgeResourceContext(input),
  async execute({ input, context }): Promise<{
    tagDefinition: TagDefinition
    knowledgeBaseId: string
  }> {
    const fieldType = input.fieldType ?? 'text'
    if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(fieldType)) {
      throw new OrchestrationError('validation', 'Invalid field type')
    }
    const tagSlot =
      input.tagSlot ?? (await getNextAvailableSlot(context.knowledgeBaseId, fieldType))
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
    )
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
  resolveContext: ({ input }: { input: UpdateKnowledgeTagInput }) =>
    resolveActiveKnowledgeTagContext(input),
  async execute({ input, context }): Promise<{
    tagDefinition: TagDefinition
    knowledgeBaseId: string
  }> {
    if (input.updates.displayName === undefined && input.updates.fieldType === undefined) {
      throw new OrchestrationError('validation', 'No tag updates specified')
    }
    return {
      tagDefinition: await updateTagDefinition(
        context.tagDefinitionId,
        input.updates,
        generateRequestId()
      ),
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
  resolveContext: ({ input }: { input: DeleteKnowledgeTagInput }) =>
    resolveActiveKnowledgeTagContext(input),
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
  resolveContext: ({ input }: { input: ListKnowledgeTagsInput }) =>
    resolveActiveKnowledgeResourceContext(input),
  async execute({ context }) {
    return { usage: await getTagUsageStats(context.knowledgeBaseId, generateRequestId()) }
  },
})

export const readDetailedKnowledgeTagUsage = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDetailedTagUsage,
  resolveContext: ({ input }: { input: ListKnowledgeTagsInput }) =>
    resolveActiveKnowledgeResourceContext(input),
  async execute({ context }) {
    return { usage: await getTagUsage(context.knowledgeBaseId, generateRequestId()) }
  },
})

export const readNextKnowledgeTagSlot = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readNextTagSlot,
  resolveContext: ({ input }: { input: ReadNextKnowledgeTagSlotInput }) =>
    resolveActiveKnowledgeResourceContext(input),
  async execute({ input, context }) {
    if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(input.fieldType)) {
      throw new OrchestrationError('validation', 'Invalid field type')
    }
    const existingDefinitions = await getTagDefinitions(context.knowledgeBaseId)
    const usedSlots = existingDefinitions
      .filter((definition) => definition.fieldType === input.fieldType)
      .map((definition) => definition.tagSlot)
    const existingBySlot = new Map(
      existingDefinitions.map((definition) => [definition.tagSlot, definition])
    )
    const nextAvailableSlot = await getNextAvailableSlot(
      context.knowledgeBaseId,
      input.fieldType,
      existingBySlot
    )
    return {
      nextAvailableSlot,
      fieldType: input.fieldType,
      usedSlots,
      totalSlots: 7,
      availableSlots: nextAvailableSlot ? 7 - usedSlots.length : 0,
    }
  },
})

export const listKnowledgeDocumentTagDefinitions = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listTags,
  resolveContext: ({ input }: { input: KnowledgeDocumentTagDefinitionsInput }) =>
    resolveCanonicalActiveKnowledgeDocumentContext(input),
  async execute({ context }) {
    return { tagDefinitions: await getDocumentTagDefinitions(context.knowledgeBaseId) }
  },
})

export const saveKnowledgeDocumentTagDefinitions = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.saveDocumentTagDefinitions,
  resolveContext: ({ input }: { input: SaveKnowledgeDocumentTagDefinitionsInput }) =>
    resolveCanonicalActiveKnowledgeDocumentContext(input),
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

export const deleteKnowledgeDocumentTagDefinitions = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteDocumentTagDefinitions,
  resolveContext: ({ input }: { input: DeleteKnowledgeDocumentTagDefinitionsInput }) =>
    resolveCanonicalActiveKnowledgeDocumentContext(input),
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
