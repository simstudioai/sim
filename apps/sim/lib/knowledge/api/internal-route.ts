import {
  type Principal,
  resolvePrincipalSubject,
  resolvePrincipalSubjectUserId,
  type SessionPrincipal,
} from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge/base'
import { type ChunkData, chunkDataSchema } from '@/lib/api/contracts/knowledge/chunks'
import {
  type ConnectorData,
  type ConnectorDetailData,
  type ConnectorMemberSummary,
  connectorDataSchema,
  connectorDetailDataSchema,
} from '@/lib/api/contracts/knowledge/connectors'
import { type DocumentData, documentDataSchema } from '@/lib/api/contracts/knowledge/documents'
import { type TagDefinitionData, tagDefinitionDataSchema } from '@/lib/api/contracts/knowledge/tags'
import { AuthType, type AuthTypeValue } from '@/lib/auth/hybrid'
import {
  requireWorkspaceBillingAttributionHeader,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import type {
  CreateKnowledgeBaseInput,
  InternalKnowledgeBaseResult,
  KnowledgeBaseResult,
} from '@/lib/knowledge/application/knowledge-bases'
import type { CreatedKnowledgeDocument } from '@/lib/knowledge/orchestration/documents'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { captureServerEvent } from '@/lib/posthog/server'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

export function internalKnowledgeActorUserId(principal: Principal): string {
  const userId = resolvePrincipalSubjectUserId(principal)
  if (!userId) {
    throw new OrchestrationError('forbidden', 'Knowledge operation requires a user subject')
  }
  return userId
}

export function internalKnowledgeProvenanceUserId(
  headers: Headers,
  principal: Principal,
  workspaceId: string | undefined
): string {
  if (principal.kind !== 'delegated') return internalKnowledgeActorUserId(principal)
  const subject = resolvePrincipalSubject(principal)
  if (subject?.kind === 'sim_user') return subject.userId
  return requireWorkspaceBillingAttributionHeader(headers, {
    workspaceId: workspaceId ?? principal.workspaceId,
  }).actorUserId
}

export function internalKnowledgeAuthType(principal: Principal): AuthTypeValue {
  return principal.kind === 'delegated' ? AuthType.INTERNAL_JWT : AuthType.SESSION
}

export async function resolveInternalKnowledgeBillingAttribution(
  request: NextRequest,
  principal: Principal,
  workspaceId: string
) {
  if (principal.kind === 'delegated') {
    return requireWorkspaceBillingAttributionHeader(request.headers, { workspaceId })
  }
  return await resolveBillingAttribution({
    actorUserId: internalKnowledgeActorUserId(principal),
    workspaceId,
  })
}

function internalKnowledgeAnalyticsUserId(principal: Principal): string | null {
  const subject = resolvePrincipalSubject(principal)
  return subject?.kind === 'sim_user' ? subject.userId : null
}

function serializeDate(date: Date | string): string {
  return date instanceof Date ? date.toISOString() : date
}

function serializeNullableDate(date: Date | string | null): string | null {
  return date ? serializeDate(date) : null
}

export function toInternalKnowledgeDocument<
  T extends {
    uploadedAt: Date | string
    processingQueuedAt?: Date | string | null
    processingStartedAt?: Date | string | null
    processingCompletedAt?: Date | string | null
    date1?: Date | string | null
    date2?: Date | string | null
  },
>(document: T): DocumentData {
  return documentDataSchema.parse({
    ...document,
    uploadedAt: serializeDate(document.uploadedAt),
    processingQueuedAt: serializeNullableDate(document.processingQueuedAt ?? null),
    processingStartedAt: serializeNullableDate(document.processingStartedAt ?? null),
    processingCompletedAt: serializeNullableDate(document.processingCompletedAt ?? null),
    date1: serializeNullableDate(document.date1 ?? null),
    date2: serializeNullableDate(document.date2 ?? null),
  })
}

export function toInternalKnowledgeChunk<
  T extends { createdAt: Date | string; updatedAt: Date | string },
>(chunk: T): ChunkData {
  return chunkDataSchema.parse({
    ...chunk,
    createdAt: serializeDate(chunk.createdAt),
    updatedAt: serializeDate(chunk.updatedAt),
  })
}

export function toInternalKnowledgeTag<
  T extends { createdAt: Date | string; updatedAt: Date | string },
>(tag: T): TagDefinitionData {
  return tagDefinitionDataSchema.parse({
    ...tag,
    createdAt: serializeDate(tag.createdAt),
    updatedAt: serializeDate(tag.updatedAt),
  })
}

export function toInternalKnowledgeConnector<
  T extends {
    sourceConfig: unknown
    createdAt: Date | string
    updatedAt: Date | string
    lastSyncAt: Date | string | null
    nextSyncAt: Date | string | null
    lastMemberSyncAt: Date | string | null
    nextMemberSyncAt: Date | string | null
    viewerMembership?: ConnectorData['viewerMembership']
  },
>(connector: T): ConnectorData {
  return connectorDataSchema.parse({
    /** A mutation answers with the row alone; only a viewer's read carries their membership. */
    viewerMembership: null,
    ...connector,
    createdAt: serializeDate(connector.createdAt),
    updatedAt: serializeDate(connector.updatedAt),
    lastSyncAt: serializeNullableDate(connector.lastSyncAt),
    nextSyncAt: serializeNullableDate(connector.nextSyncAt),
    lastMemberSyncAt: serializeNullableDate(connector.lastMemberSyncAt),
    nextMemberSyncAt: serializeNullableDate(connector.nextMemberSyncAt),
  })
}

export function toInternalKnowledgeConnectorDetail<
  T extends Parameters<typeof toInternalKnowledgeConnector>[0] & {
    syncLogs: Array<{
      startedAt: Date | string
      completedAt: Date | string | null
      [key: string]: unknown
    }>
    memberSyncLogs: Array<{
      startedAt: Date | string
      completedAt: Date | string | null
      [key: string]: unknown
    }>
    members: ConnectorMemberSummary
  },
>(connector: T): ConnectorDetailData {
  return connectorDetailDataSchema.parse({
    ...toInternalKnowledgeConnector(connector),
    syncLogs: connector.syncLogs.map((log) => ({
      ...log,
      startedAt: serializeDate(log.startedAt),
      completedAt: serializeNullableDate(log.completedAt),
    })),
    memberSyncLogs: connector.memberSyncLogs.map((log) => ({
      ...log,
      startedAt: serializeDate(log.startedAt),
      completedAt: serializeNullableDate(log.completedAt),
    })),
    members: connector.members,
  })
}

export function toInternalKnowledgeDocumentUpload(
  session: UploadSessionRecord,
  document: CreatedKnowledgeDocument | null
) {
  if (!session.knowledgeBaseId) {
    throw new Error('Knowledge-document upload session is missing its knowledge base')
  }
  return {
    id: session.id,
    knowledgeBaseId: session.knowledgeBaseId,
    status: session.status,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: serializeDate(session.expiresAt),
    error: session.error,
    document: document
      ? {
          id: document.id,
          knowledgeBaseId: document.knowledgeBaseId,
          filename: document.filename,
          fileSize: document.fileSize,
          mimeType: document.mimeType,
          processingStatus: document.processingStatus ?? 'pending',
          chunkCount: document.chunkCount,
          tokenCount: document.tokenCount,
          characterCount: document.characterCount,
          enabled: document.enabled,
          createdAt: serializeNullableDate(document.uploadedAt),
        }
      : null,
  }
}

function toInternalKnowledgeBase(knowledgeBase: KnowledgeBaseWithCounts): KnowledgeBaseData {
  return {
    ...knowledgeBase,
    chunkingConfig: { ...knowledgeBase.chunkingConfig },
    createdAt: serializeDate(knowledgeBase.createdAt),
    updatedAt: serializeDate(knowledgeBase.updatedAt),
    deletedAt: knowledgeBase.deletedAt ? serializeDate(knowledgeBase.deletedAt) : null,
  }
}

export const internalKnowledgePresenters = {
  list({ knowledgeBases }: { knowledgeBases: KnowledgeBaseWithCounts[] }) {
    return { success: true as const, data: knowledgeBases.map(toInternalKnowledgeBase) }
  },
  create({ knowledgeBase }: KnowledgeBaseResult) {
    return { success: true as const, data: toInternalKnowledgeBase(knowledgeBase) }
  },
  read({ knowledgeBase }: InternalKnowledgeBaseResult) {
    return { success: true as const, data: toInternalKnowledgeBase(knowledgeBase) }
  },
  deleted() {
    return {
      success: true as const,
      data: { message: 'Knowledge base deleted successfully' },
    }
  },
} as const

export const internalKnowledgeAnalytics = {
  created({
    principal,
    result: { knowledgeBase },
  }: {
    principal: SessionPrincipal
    input: CreateKnowledgeBaseInput
    result: KnowledgeBaseResult
  }): void {
    if (!knowledgeBase.workspaceId) {
      throw new Error('Created knowledge base is missing its workspace analytics scope')
    }
    PlatformEvents.knowledgeBaseCreated({
      knowledgeBaseId: knowledgeBase.id,
      name: knowledgeBase.name,
      workspaceId: knowledgeBase.workspaceId,
    })
    captureServerEvent(
      principal.userId,
      'knowledge_base_created',
      {
        knowledge_base_id: knowledgeBase.id,
        workspace_id: knowledgeBase.workspaceId,
        name: knowledgeBase.name,
      },
      {
        groups: { workspace: knowledgeBase.workspaceId },
        setOnce: { first_kb_created_at: new Date().toISOString() },
      }
    )
  },
  documentsUploaded({
    principal,
    input,
    result,
  }: {
    principal: Principal
    input: { processingOptions?: { recipe?: string } }
    result:
      | {
          kind: 'single'
          workspaceId?: string
          data: { knowledgeBaseId: string; mimeType: string; fileSize: number }
        }
      | { kind: 'bulk'; workspaceId?: string; data: { total: number }; knowledgeBaseId?: string }
  }): void {
    const documentCount = result.kind === 'bulk' ? result.data.total : 1
    const knowledgeBaseId =
      result.kind === 'single' ? result.data.knowledgeBaseId : result.knowledgeBaseId
    if (!knowledgeBaseId) {
      throw new Error('Bulk document result is missing its knowledge base analytics scope')
    }
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId,
      documentsCount: documentCount,
      uploadType: result.kind,
      ...(result.kind === 'single'
        ? { mimeType: result.data.mimeType, fileSize: result.data.fileSize }
        : { recipe: input.processingOptions?.recipe }),
    })
    const userId = internalKnowledgeAnalyticsUserId(principal)
    if (!userId) return
    captureServerEvent(
      userId,
      'knowledge_base_document_uploaded',
      {
        knowledge_base_id: knowledgeBaseId,
        workspace_id: result.workspaceId ?? '',
        document_count: documentCount,
        upload_type: result.kind,
      },
      {
        ...(result.workspaceId ? { groups: { workspace: result.workspaceId } } : {}),
        setOnce: { first_document_uploaded_at: new Date().toISOString() },
      }
    )
  },
  documentUpserted({
    input,
    result,
  }: {
    principal: Principal
    input: { processingOptions?: { recipe?: string } }
    result: { knowledgeBaseId: string }
  }): void {
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId: result.knowledgeBaseId,
      documentsCount: 1,
      uploadType: 'single',
      recipe: input.processingOptions?.recipe,
    })
  },
  documentDeleted({
    principal,
    result,
  }: {
    principal: Principal
    result: { knowledgeBaseId: string; workspaceId?: string }
  }): void {
    const workspaceId = result.workspaceId
    if (!workspaceId) throw new Error('Deleted document result is missing its workspace scope')
    const userId = internalKnowledgeAnalyticsUserId(principal)
    if (!userId) return
    captureServerEvent(
      userId,
      'knowledge_base_document_deleted',
      { knowledge_base_id: result.knowledgeBaseId, workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )
  },
  connectorAdded({
    principal,
    result: { connector, workspaceId, organizationId },
  }: {
    principal: Principal
    input: unknown
    result: {
      workspaceId?: string
      organizationId?: string
      connector: {
        knowledgeBaseId: string
        connectorType: string
        syncIntervalMinutes: number
      }
    }
  }): void {
    const userId = internalKnowledgeAnalyticsUserId(principal)
    if (!userId) return
    captureServerEvent(
      userId,
      'knowledge_base_connector_added',
      {
        knowledge_base_id: connector.knowledgeBaseId,
        workspace_id: workspaceId,
        organization_id: organizationId,
        connector_type: connector.connectorType,
        sync_interval_minutes: connector.syncIntervalMinutes,
      },
      {
        groups: workspaceId
          ? { workspace: workspaceId }
          : organizationId
            ? { organization: organizationId }
            : undefined,
        setOnce: { first_connector_added_at: new Date().toISOString() },
      }
    )
  },
  connectorRemoved({
    principal,
    result,
  }: {
    principal: Principal
    input: unknown
    result: {
      knowledgeBaseId: string
      connectorType: string
      documentsDeleted: number
      workspaceId?: string
    }
  }): void {
    if (!result.workspaceId) return
    const userId = internalKnowledgeAnalyticsUserId(principal)
    if (!userId) return
    captureServerEvent(
      userId,
      'knowledge_base_connector_removed',
      {
        knowledge_base_id: result.knowledgeBaseId,
        workspace_id: result.workspaceId,
        connector_type: result.connectorType,
        documents_deleted: result.documentsDeleted,
      },
      { groups: { workspace: result.workspaceId } }
    )
  },
  connectorSynced({
    principal,
    result,
  }: {
    principal: Principal
    input: unknown
    result: {
      knowledgeBaseId: string
      connectorType: string
      workspaceId?: string
      organizationId?: string
    }
  }): void {
    if (!result.workspaceId && !result.organizationId) {
      throw new Error('Synced connector result is missing its owner analytics scope')
    }
    const userId = internalKnowledgeAnalyticsUserId(principal)
    if (!userId) return
    captureServerEvent(
      userId,
      'knowledge_base_connector_synced',
      {
        knowledge_base_id: result.knowledgeBaseId,
        workspace_id: result.workspaceId,
        organization_id: result.organizationId,
        connector_type: result.connectorType,
      },
      {
        groups: result.workspaceId
          ? { workspace: result.workspaceId }
          : { organization: result.organizationId! },
      }
    )
  },
} as const
