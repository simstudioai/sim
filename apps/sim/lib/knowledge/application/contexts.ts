import { db } from '@sim/db'
import { embedding } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type {
  KnowledgeAuthorizationContext,
  LegacyPersonalKnowledgeAuthorizationContext,
} from '@/lib/knowledge/application/authorization'
import type { ChunkData } from '@/lib/knowledge/chunks/types'
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
import {
  loadActiveWorkspaceApplicationContext,
  loadWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

export interface KnowledgeWorkspaceContext extends KnowledgeAuthorizationContext {
  billedAccountUserId: string
}

export interface LegacyPersonalKnowledgeContext
  extends LegacyPersonalKnowledgeAuthorizationContext {}

export type KnowledgeResourceContext = KnowledgeWorkspaceContext | LegacyPersonalKnowledgeContext

export interface ActiveKnowledgeBaseContext extends KnowledgeWorkspaceContext {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBaseWithCounts
}

export type ActiveKnowledgeResourceBaseContext = KnowledgeResourceContext & {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBaseWithCounts
}

export type ActiveKnowledgeDocumentContext = ActiveKnowledgeResourceBaseContext & {
  documentId: string
  document: ActiveKnowledgeDocument
}

export type ActiveKnowledgeTagContext = ActiveKnowledgeResourceBaseContext & {
  tagDefinitionId: string
  tagDefinition: DocumentTagDefinition
}

export type ActiveKnowledgeConnectorContext = ActiveKnowledgeResourceBaseContext & {
  connectorId: string
  connector: ActiveKnowledgeConnectorReference
}

export type ActiveKnowledgeChunkContext = ActiveKnowledgeDocumentContext & {
  chunkId: string
  chunk: ChunkData
}

export async function loadKnowledgeWorkspaceContext(
  workspaceId: string
): Promise<KnowledgeWorkspaceContext | null> {
  return loadActiveWorkspaceApplicationContext(workspaceId)
}

export async function loadKnowledgeWorkspaceAuthorizationContext(
  workspaceId: string,
  options: { includeArchived?: boolean } = {}
): Promise<KnowledgeWorkspaceContext | null> {
  return loadWorkspaceApplicationContext(workspaceId, options)
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

export async function resolveActiveKnowledgeResourceContext(input: {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeResourceBaseContext> {
  const knowledgeBase = await getKnowledgeBaseById(input.knowledgeBaseId)
  if (
    !knowledgeBase ||
    (input.assertedWorkspaceId !== undefined &&
      knowledgeBase.workspaceId !== input.assertedWorkspaceId)
  ) {
    throw new OrchestrationError('not_found', 'Knowledge base not found')
  }
  if (!knowledgeBase.workspaceId) {
    return {
      workspaceId: undefined,
      legacyPersonalOwnerUserId: knowledgeBase.userId,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBase,
    }
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
  const context = await resolveActiveKnowledgeResourceContext(input)
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
  const context = await resolveActiveKnowledgeResourceContext({
    knowledgeBaseId: document.knowledgeBaseId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  return {
    ...context,
    documentId: document.id,
    document,
  }
}

export async function resolveActiveKnowledgeChunkContext(input: {
  knowledgeBaseId: string
  documentId: string
  chunkId: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeChunkContext> {
  const [chunk] = await db
    .select()
    .from(embedding)
    .where(and(eq(embedding.id, input.chunkId), eq(embedding.documentId, input.documentId)))
    .limit(1)
  if (!chunk || chunk.knowledgeBaseId !== input.knowledgeBaseId) {
    throw new OrchestrationError('not_found', 'Chunk not found')
  }
  const context = await resolveCanonicalActiveKnowledgeDocumentContext(input)
  return {
    ...context,
    chunkId: chunk.id,
    chunk: chunk as ChunkData,
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
  const context = await resolveActiveKnowledgeResourceContext({
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
  const context = await resolveActiveKnowledgeResourceContext({
    knowledgeBaseId: connector.knowledgeBaseId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  return {
    ...context,
    connectorId: connector.id,
    connector,
  }
}
