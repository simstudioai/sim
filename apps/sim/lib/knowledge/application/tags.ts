import { AuditAction, AuditResourceType } from '@sim/audit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeTagContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  createTagDefinition,
  deleteTagDefinition,
  getDocumentTagDefinitions,
  getNextAvailableSlot,
  getTagUsageStats,
  updateTagDefinition,
} from '@/lib/knowledge/tags/service'
import type { TagDefinition, UpdateTagDefinitionData } from '@/lib/knowledge/types'

export interface ListKnowledgeTagsInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
}

export interface CreateKnowledgeTagInput extends ListKnowledgeTagsInput {
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

export const listKnowledgeTags = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listTags,
  resolveContext: ({ input }: { input: ListKnowledgeTagsInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ context }) {
    return { tagDefinitions: await getDocumentTagDefinitions(context.knowledgeBaseId) }
  },
})

export const createKnowledgeTag = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createTag,
  resolveContext: ({ input }: { input: CreateKnowledgeTagInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ input, context }): Promise<{
    tagDefinition: TagDefinition
    knowledgeBaseId: string
  }> {
    const fieldType = input.fieldType ?? 'text'
    const tagSlot = await getNextAvailableSlot(context.knowledgeBaseId, fieldType)
    if (!tagSlot) {
      throw new OrchestrationError(
        'validation',
        `No available slots for field type "${fieldType}". Maximum tags of this type reached.`
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
    resolveActiveKnowledgeBaseContext(input),
  async execute({ context }) {
    return { usage: await getTagUsageStats(context.knowledgeBaseId, generateRequestId()) }
  },
})
