import { AuditAction, AuditResourceType } from '@sim/audit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  type KnowledgeWorkspaceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  deleteKnowledgeBase,
  findActiveKnowledgeBasesByExactName,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'

interface KnowledgeVfsReferenceInput {
  workspaceId: string
  sourceName: string
}

export interface RenameKnowledgeBaseByVfsPathInput extends KnowledgeVfsReferenceInput {
  newName: string
}

export type DeleteKnowledgeBaseByVfsPathInput = KnowledgeVfsReferenceInput

async function resolveKnowledgeBaseByVfsName(
  context: KnowledgeWorkspaceContext,
  sourceName: string
): Promise<Omit<KnowledgeBaseWithCounts, 'connectorTypes'>> {
  const matches = await findActiveKnowledgeBasesByExactName(context.workspaceId, sourceName)
  if (matches.length > 1) {
    throw new OrchestrationError(
      'conflict',
      `Knowledge base path is ambiguous: knowledgebases/${sourceName}`
    )
  }
  const knowledgeBase = matches[0]
  if (!knowledgeBase) {
    throw new OrchestrationError(
      'not_found',
      `Knowledge base not found at knowledgebases/${sourceName}`
    )
  }
  return knowledgeBase
}

export const renameKnowledgeBaseByVfsPath = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.renameByVfsPath,
  resolveContext: ({ input }: { input: RenameKnowledgeBaseByVfsPathInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ input, context }) {
    const knowledgeBase = await resolveKnowledgeBaseByVfsName(context, input.sourceName)
    const updated = await updateKnowledgeBase(
      knowledgeBase.id,
      { name: input.newName },
      generateRequestId(),
      { assertedWorkspaceId: context.workspaceId }
    )
    return {
      id: updated.id,
      name: updated.name,
      previousName: knowledgeBase.name,
      workspaceId: context.workspaceId,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Renamed knowledge base to "${result.name}"`,
    metadata: { source: 'copilot_vfs', previousName: result.previousName, updatedFields: ['name'] },
  }),
})

export const deleteKnowledgeBaseByVfsPath = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteByVfsPath,
  resolveContext: ({ input }: { input: DeleteKnowledgeBaseByVfsPathInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ input, context }) {
    const knowledgeBase = await resolveKnowledgeBaseByVfsName(context, input.sourceName)
    await deleteKnowledgeBase(knowledgeBase.id, generateRequestId(), {
      assertedWorkspaceId: context.workspaceId,
    })
    return {
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      workspaceId: context.workspaceId,
      deleted: true as const,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_DELETED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Deleted knowledge base "${result.name}"`,
    metadata: { source: 'copilot_vfs', knowledgeBaseName: result.name },
  }),
})
