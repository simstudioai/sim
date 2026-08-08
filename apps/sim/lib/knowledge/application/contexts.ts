import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { KnowledgeAuthorizationContext } from '@/lib/knowledge/application/authorization'
import type { ActiveKnowledgeDocument } from '@/lib/knowledge/documents/service'
import { getKnowledgeDocument } from '@/lib/knowledge/documents/service'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface KnowledgeWorkspaceContext extends KnowledgeAuthorizationContext {
  billedAccountUserId: string
}

export interface ActiveKnowledgeBaseContext extends KnowledgeWorkspaceContext {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBaseWithCounts
}

export interface ActiveKnowledgeDocumentContext extends ActiveKnowledgeBaseContext {
  documentId: string
  document: ActiveKnowledgeDocument
}

export async function loadKnowledgeWorkspaceContext(
  workspaceId: string
): Promise<KnowledgeWorkspaceContext | null> {
  return loadActiveWorkspaceApplicationContext(workspaceId)
}

export async function resolveKnowledgeWorkspaceContext(input: {
  workspaceId: string
}): Promise<KnowledgeWorkspaceContext> {
  const context = await loadKnowledgeWorkspaceContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

export async function resolveActiveKnowledgeBaseContext(input: {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeBaseContext> {
  const knowledgeBase = await getKnowledgeBaseById(input.knowledgeBaseId)
  if (
    !knowledgeBase?.workspaceId ||
    (input.assertedWorkspaceId !== undefined &&
      knowledgeBase.workspaceId !== input.assertedWorkspaceId)
  ) {
    throw new OrchestrationError('not_found', 'Knowledge base not found')
  }
  const workspaceContext = await loadKnowledgeWorkspaceContext(knowledgeBase.workspaceId)
  if (!workspaceContext) throw new OrchestrationError('not_found', 'Knowledge base not found')
  return {
    ...workspaceContext,
    knowledgeBaseId: knowledgeBase.id,
    knowledgeBase,
  }
}

export async function resolveActiveKnowledgeDocumentContext(input: {
  knowledgeBaseId: string
  documentId: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeDocumentContext> {
  const context = await resolveActiveKnowledgeBaseContext(input)
  const document = await getKnowledgeDocument(context.knowledgeBaseId, input.documentId)
  if (!document) throw new OrchestrationError('not_found', 'Document not found')
  return {
    ...context,
    documentId: document.id,
    document,
  }
}
