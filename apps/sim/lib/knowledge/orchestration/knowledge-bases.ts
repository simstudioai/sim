import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { DEFAULT_CHUNKING_CONFIG } from '@/lib/knowledge/constants'
import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'
import {
  auditActorFields,
  classifyKnowledgeFailure,
  fail,
  type KnowledgeOperationContext,
  type KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import type { ChunkingConfig, KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('KnowledgeBaseOrchestration')

export type PerformKnowledgeBaseResult = KnowledgeOrchestrationResult<{
  knowledgeBase: KnowledgeBaseWithCounts
}>

export interface PerformCreateKnowledgeBaseParams extends KnowledgeOperationContext {
  workspaceId: string
  name: string
  description?: string
  /** Folder in the workspace's `knowledge_base` tree; `null`/omitted is the root. */
  folderId?: string | null
  /** Omitted fields fall back to {@link DEFAULT_CHUNKING_CONFIG}. */
  chunkingConfig?: Partial<ChunkingConfig>
}

/**
 * Creates a knowledge base on behalf of an actor, as the single implementation
 * behind the UI route, the v1 and v2 public APIs, and the copilot agent tool.
 *
 * The chunking default lives here rather than at each boundary: when every
 * caller carried its own literal the agent's `minSize` was 1 against the API's
 * 100, so identical input produced differently-chunked knowledge bases
 * depending on who created it. The audit likewise lives here rather than in the
 * three HTTP routes that each had their own copy — which is why an
 * agent-created knowledge base used to leave no audit trail at all.
 *
 * The caller owns authentication; `createKnowledgeBase` still enforces the
 * workspace write permission itself, and that failure comes back as `forbidden`.
 */
export async function performCreateKnowledgeBase(
  params: PerformCreateKnowledgeBaseParams
): Promise<PerformKnowledgeBaseResult> {
  const { workspaceId, name, description, folderId, request, source } = params
  const requestId = params.requestId ?? generateRequestId()
  const chunkingConfig: ChunkingConfig = { ...DEFAULT_CHUNKING_CONFIG, ...params.chunkingConfig }
  const { model: embeddingModel, dimensions: embeddingDimension } = await getConfiguredKbEmbedding()

  let created: KnowledgeBaseWithCounts
  try {
    created = await createKnowledgeBase(
      {
        name,
        description,
        workspaceId,
        folderId,
        userId: params.userId,
        embeddingModel,
        embeddingDimension,
        chunkingConfig,
      },
      requestId
    )
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Create knowledge base "${name}"`)
  }

  logger.info(`[${requestId}] Created knowledge base ${created.id} for user ${params.userId}`)

  PlatformEvents.knowledgeBaseCreated({
    knowledgeBaseId: created.id,
    name: created.name,
    workspaceId,
  })

  captureServerEvent(
    params.userId,
    'knowledge_base_created',
    { knowledge_base_id: created.id, workspace_id: workspaceId, name: created.name },
    {
      groups: { workspace: workspaceId },
      setOnce: { first_kb_created_at: new Date().toISOString() },
    }
  )

  recordAudit({
    workspaceId,
    ...auditActorFields(params),
    action: AuditAction.KNOWLEDGE_BASE_CREATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: created.id,
    resourceName: created.name,
    description: `Created knowledge base "${created.name}"`,
    metadata: {
      source,
      name: created.name,
      description: created.description,
      embeddingModel,
      embeddingDimension,
      chunkingStrategy: chunkingConfig.strategy,
      chunkMaxSize: chunkingConfig.maxSize,
      chunkMinSize: chunkingConfig.minSize,
      chunkOverlap: chunkingConfig.overlap,
    },
    ...(request ? { request } : {}),
  })

  return { success: true, knowledgeBase: created }
}

export interface PerformUpdateKnowledgeBaseParams extends KnowledgeOperationContext {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
  /** Workspace the knowledge base currently belongs to, for the audit row. */
  workspaceId: string | null
  updates: {
    name?: string
    description?: string
    /** Moves the knowledge base between workspaces; omitted leaves it in place. */
    workspaceId?: string | null
    folderId?: string | null
    chunkingConfig?: ChunkingConfig
  }
}

/**
 * Applies a knowledge base update and records it against the actor.
 *
 * `actorUserId` is always forwarded, so a workspace move is authorized against
 * the caller rather than rejected for a missing actor — the v1 and v2 routes
 * previously omitted it.
 */
export async function performUpdateKnowledgeBase(
  params: PerformUpdateKnowledgeBaseParams
): Promise<PerformKnowledgeBaseResult> {
  const { knowledgeBaseId, updates, request, source } = params
  const requestId = params.requestId ?? generateRequestId()

  const updatedFields = Object.keys(updates).filter(
    (key) => updates[key as keyof typeof updates] !== undefined
  )
  if (updatedFields.length === 0) {
    return fail('No updates specified', 'validation')
  }

  let updated: KnowledgeBaseWithCounts
  try {
    updated = await updateKnowledgeBase(knowledgeBaseId, updates, requestId, {
      actorUserId: params.userId,
      assertedWorkspaceId: params.assertedWorkspaceId,
    })
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Update knowledge base ${knowledgeBaseId}`)
  }

  logger.info(`[${requestId}] Updated knowledge base ${knowledgeBaseId}`)

  recordAudit({
    // The destination workspace when this update moved it, so the audit row
    // lands where the knowledge base now lives.
    workspaceId: updates.workspaceId !== undefined ? updates.workspaceId : params.workspaceId,
    ...auditActorFields(params),
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: knowledgeBaseId,
    resourceName: updated.name,
    description: `Updated knowledge base "${updated.name}"`,
    metadata: {
      source,
      updatedFields,
      ...(updates.name && { newName: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.chunkingConfig && {
        chunkMaxSize: updates.chunkingConfig.maxSize,
        chunkMinSize: updates.chunkingConfig.minSize,
        chunkOverlap: updates.chunkingConfig.overlap,
      }),
    },
    ...(request ? { request } : {}),
  })

  return { success: true, knowledgeBase: updated }
}

export interface PerformDeleteKnowledgeBaseParams extends KnowledgeOperationContext {
  allowSearchIndexDelete?: boolean
  knowledgeBase: { id: string; name: string; workspaceId: string | null }
  assertedWorkspaceId?: string
}

export type PerformDeleteKnowledgeBaseResult = KnowledgeOrchestrationResult

/**
 * Archives a knowledge base and its documents and connectors.
 *
 * The folder cascade and other internal callers keep calling
 * `deleteKnowledgeBase` directly and stay silent by construction — auditing
 * follows from a user performing this operation, not from the write running.
 */
export async function performDeleteKnowledgeBase(
  params: PerformDeleteKnowledgeBaseParams
): Promise<PerformDeleteKnowledgeBaseResult> {
  const { knowledgeBase, request, source } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    await deleteKnowledgeBase(knowledgeBase.id, requestId, {
      assertedWorkspaceId: params.assertedWorkspaceId,
      allowSearchIndexDelete: params.allowSearchIndexDelete,
    })
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Delete knowledge base ${knowledgeBase.id}`)
  }

  logger.info(`[${requestId}] Deleted knowledge base ${knowledgeBase.id}`)

  PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: knowledgeBase.id })

  recordAudit({
    workspaceId: knowledgeBase.workspaceId,
    ...auditActorFields(params),
    action: AuditAction.KNOWLEDGE_BASE_DELETED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: knowledgeBase.id,
    resourceName: knowledgeBase.name,
    description: `Deleted knowledge base "${knowledgeBase.name}"`,
    metadata: { source, knowledgeBaseName: knowledgeBase.name },
    ...(request ? { request } : {}),
  })

  return { success: true }
}
