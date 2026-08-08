import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { KnowledgeAuthorizationContext } from '@/lib/knowledge/application/authorization'
import {
  type ActiveKnowledgeConnectorReference,
  getActiveKnowledgeConnectorReference,
} from '@/lib/knowledge/connectors/service'
import type { ActiveKnowledgeDocument } from '@/lib/knowledge/documents/service'
import { getKnowledgeDocument, getKnowledgeDocumentById } from '@/lib/knowledge/documents/service'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { getTagDefinitionById } from '@/lib/knowledge/tags/service'
import type { DocumentTagDefinition } from '@/lib/knowledge/tags/types'
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

export interface ActiveKnowledgeTagContext extends ActiveKnowledgeBaseContext {
  tagDefinitionId: string
  tagDefinition: DocumentTagDefinition
}

export interface ActiveKnowledgeConnectorContext extends ActiveKnowledgeBaseContext {
  connectorId: string
  connector: ActiveKnowledgeConnectorReference
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

export async function resolveCanonicalActiveKnowledgeDocumentContext(input: {
  knowledgeBaseId: string
  documentId: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeDocumentContext> {
  const document = await getKnowledgeDocumentById(input.documentId)
  if (!document || document.knowledgeBaseId !== input.knowledgeBaseId) {
    throw new OrchestrationError('not_found', 'Document not found')
  }
  const context = await resolveActiveKnowledgeBaseContext({
    knowledgeBaseId: document.knowledgeBaseId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  return {
    ...context,
    documentId: document.id,
    document,
  }
}

export async function resolveActiveKnowledgeTagContext(input: {
  tagDefinitionId: string
  knowledgeBaseId?: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeTagContext> {
  const tagDefinition = await getTagDefinitionById(input.tagDefinitionId)
  if (
    !tagDefinition ||
    (input.knowledgeBaseId && tagDefinition.knowledgeBaseId !== input.knowledgeBaseId)
  ) {
    throw new OrchestrationError('not_found', 'Tag definition not found')
  }
  const context = await resolveActiveKnowledgeBaseContext({
    knowledgeBaseId: tagDefinition.knowledgeBaseId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  return {
    ...context,
    tagDefinitionId: tagDefinition.id,
    tagDefinition,
  }
}

export async function resolveActiveKnowledgeConnectorContext(input: {
  connectorId: string
  knowledgeBaseId?: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeConnectorContext> {
  const connector = await getActiveKnowledgeConnectorReference(input.connectorId)
  if (
    !connector ||
    (input.knowledgeBaseId && connector.knowledgeBaseId !== input.knowledgeBaseId)
  ) {
    throw new OrchestrationError('not_found', 'Connector not found')
  }
  const context = await resolveActiveKnowledgeBaseContext({
    knowledgeBaseId: connector.knowledgeBaseId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  return {
    ...context,
    connectorId: connector.id,
    connector,
  }
}
