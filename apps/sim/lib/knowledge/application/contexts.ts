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

/**
 * Loads a knowledge base and asserts it lives in `workspaceId` when the caller named one.
 *
 * Shared by both resolvers below so the not-found concealment — a base outside the asserted
 * workspace is reported as missing, never as forbidden — and the nullable-`workspaceId` guard
 * that legacy personal bases need are written once, and cannot be dropped from one path only.
 */
async function requireKnowledgeBase(knowledgeBaseId: string, workspaceId: string | undefined) {
  const knowledgeBase = await getKnowledgeBaseById(knowledgeBaseId)
  if (
    !knowledgeBase?.workspaceId ||
    (workspaceId !== undefined && knowledgeBase.workspaceId !== workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'Knowledge base not found')
  }
  /** The guard above proves `workspaceId` is set; carry that into the type so callers see it. */
  return knowledgeBase as typeof knowledgeBase & { workspaceId: string }
}

export async function resolveActiveKnowledgeBaseContext(input: {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
}): Promise<ActiveKnowledgeBaseContext> {
  const knowledgeBase = await requireKnowledgeBase(input.knowledgeBaseId, input.assertedWorkspaceId)
  const workspaceContext = await loadKnowledgeWorkspaceContext(knowledgeBase.workspaceId)
  if (!workspaceContext) throw new OrchestrationError('not_found', 'Knowledge base not found')
  return {
    ...workspaceContext,
    knowledgeBaseId: knowledgeBase.id,
    knowledgeBase,
  }
}

/**
 * Resolves one knowledge base against a workspace context the caller already loaded.
 *
 * Same result as {@link resolveActiveKnowledgeBaseContext}, minus its workspace load. A batch has
 * that context in hand before the first item — it is what bounded and authorized the request —
 * and it cannot differ per item, so re-resolving it once per base is a whole extra query each.
 */
export async function resolveActiveKnowledgeBaseInWorkspace(
  knowledgeBaseId: string,
  workspaceContext: KnowledgeWorkspaceContext
): Promise<ActiveKnowledgeBaseContext> {
  const knowledgeBase = await requireKnowledgeBase(knowledgeBaseId, workspaceContext.workspaceId)
  return { ...workspaceContext, knowledgeBaseId: knowledgeBase.id, knowledgeBase }
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
