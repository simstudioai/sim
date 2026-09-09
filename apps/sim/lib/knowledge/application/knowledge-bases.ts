import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { inArray } from 'drizzle-orm'
import type { CursorKey } from '@/lib/api/list-query'
import {
  authorizeWorkspaceOperation,
  type OperationUseCase,
  PrincipalKindAuthorizationError,
  type WorkspaceOperation,
} from '@/lib/core/application'
import { classifyBulkItemError } from '@/lib/core/application/bulk-items'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { loadActiveFolderPathIndex, resolveFolderPathFilter } from '@/lib/folders/queries'
import { resolveKnowledgeAccessScope } from '@/lib/knowledge/access/scope'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  BULK_DELETE_KNOWLEDGE_BASES_COST_POLICY,
  type KnowledgeBatchExecutionResult,
  requireBoundedKnowledgeBatch,
  rethrowKnowledgeBatchTerminalFailure,
} from '@/lib/knowledge/application/batch-policy'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeBaseContext,
  type KnowledgeWorkspaceContext,
  loadKnowledgeWorkspaceAuthorizationContext,
  resolveActiveKnowledgeBaseContext,
  resolveArchivedKnowledgeBaseContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import {
  knowledgeFolderPathForId,
  resolveKnowledgeFolderPath,
} from '@/lib/knowledge/application/folder-paths'
import { authorizeSearchIndexDeletion } from '@/lib/knowledge/application/knowledge-base-access'
import {
  knowledgeOperations,
  knowledgeSessionOperations,
} from '@/lib/knowledge/application/operations'
import {
  DEFAULT_CHUNKING_CONFIG,
  MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE,
} from '@/lib/knowledge/constants'
import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'
import {
  performDeleteKnowledgeBase,
  performRestoreKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration'
import type {
  KnowledgeOperationSource,
  KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import {
  attachKnowledgeBaseConnectors,
  createAuthorizedKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  getWorkspaceKnowledgeBases,
  type KnowledgeBaseScope,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import type { ChunkingConfig, KnowledgeBaseWithCounts } from '@/lib/knowledge/types'

const logger = createLogger('KnowledgeBaseApplication')

export interface ListKnowledgeBasesInput {
  workspaceId: string
  /**
   * Lifecycle set to list. Defaults to `active`; `archived` reads the
   * soft-deleted set the restore flow discovers from.
   */
  scope?: KnowledgeBaseScope
  folderPath?: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  /**
   * Page size for the public list. Omitted reads the whole workspace set, which
   * is what the internal catalog caller still wants.
   */
  limit?: number
  cursorKeys?: CursorKey[]
}

export interface KnowledgeBaseResult {
  knowledgeBase: KnowledgeBaseWithCounts
  folderPath: string
}

export interface ListKnowledgeBasesResult {
  knowledgeBases: KnowledgeBaseResult[]
  nextCursorKeys: CursorKey[] | null
  sortBy: 'name' | 'createdAt' | 'updatedAt'
  sortOrder: 'asc' | 'desc'
}

export interface RestoreKnowledgeBaseInput extends ReadKnowledgeBaseInput {
  /**
   * Which surface asked for the restore. Required, unlike its optional siblings
   * on the sibling inputs: this one reaches the orchestration call as well as
   * the audit projection, and a default there would attribute one surface's
   * restore to another.
   */
  source: KnowledgeOperationSource
}

export interface RestoreKnowledgeBaseResult extends KnowledgeBaseResult {
  /** `false` when the knowledge base was already active and nothing changed. */
  restored: boolean
}

export interface KnowledgeBaseCatalogTagDefinition {
  id: string
  knowledgeBaseId: string
  tagSlot: string
  displayName: string
  fieldType: string
}

export interface ListKnowledgeBaseCatalogResult {
  knowledgeBases: Array<
    KnowledgeBaseResult & { tagDefinitions: KnowledgeBaseCatalogTagDefinition[] }
  >
}

export interface CreateKnowledgeBaseInput {
  workspaceId: string
  name: string
  /** Set by workspace search setup; not accepted by HTTP creation contracts. */
  isSearchIndex?: boolean
  description?: string
  chunkingConfig?: Partial<ChunkingConfig>
  folderPath?: string
  folderId?: string | null
  source?: string
}

export interface ListInternalKnowledgeBasesInput {
  workspaceId?: string
  scope: KnowledgeBaseScope
}

export interface ListInternalKnowledgeBasesResult {
  knowledgeBases: KnowledgeBaseWithCounts[]
}

export interface ReadKnowledgeBaseInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
}

export interface UpdateKnowledgeBaseInput extends ReadKnowledgeBaseInput {
  name?: string
  description?: string
  chunkingConfig?: ChunkingConfig
  folderPath?: string
  source?: string
}

export interface DeleteKnowledgeBaseInput extends ReadKnowledgeBaseInput {
  source?: string
}

export interface BulkDeleteKnowledgeBasesInput {
  assertedWorkspaceId: string
  knowledgeBaseIds: string[]
  cancellationSignal?: AbortSignal
  source?: string
}

export interface BulkDeleteKnowledgeBasesResult {
  deleted: Array<{ id: string; name: string }>
  notFound: string[]
  failed: Array<{ id: string; name: string; reason: string }>
  cancelled: boolean
}

interface BulkDeleteKnowledgeBasesExecutionResult
  extends BulkDeleteKnowledgeBasesResult,
    KnowledgeBatchExecutionResult {}

interface BulkDeleteKnowledgeBasesContext extends KnowledgeWorkspaceContext {
  knowledgeBaseIds: string[]
}

export interface ReadInternalKnowledgeBaseInput {
  knowledgeBaseId: string
}

export interface UpdateInternalKnowledgeBaseInput extends ReadInternalKnowledgeBaseInput {
  name?: string
  description?: string
  workspaceId?: string
  folderId?: string | null
  chunkingConfig?: ChunkingConfig
}

export interface RestoreInternalKnowledgeBaseInput extends ReadInternalKnowledgeBaseInput {}

export interface InternalKnowledgeBaseResult {
  knowledgeBase: KnowledgeBaseWithCounts
}

function requireSessionPrincipal(
  principal: Principal,
  operationId: string
): asserts principal is SessionPrincipal {
  if (principal.kind !== 'session') {
    throw new PrincipalKindAuthorizationError(principal.kind, operationId)
  }
}

function throwKnowledgeOrchestrationFailure(
  outcome: Extract<KnowledgeOrchestrationResult, { success: false }>,
  fallback: string
): never {
  if (outcome.errorCode === 'internal') throw new Error(fallback)
  throw new OrchestrationError(outcome.errorCode, outcome.error)
}

async function loadInternalActiveKnowledgeBase(
  knowledgeBaseId: string
): Promise<KnowledgeBaseWithCounts & { workspaceId: string }> {
  const knowledgeBase = await getKnowledgeBaseById(knowledgeBaseId)
  if (!knowledgeBase?.workspaceId || knowledgeBase.organizationId) {
    throw new OrchestrationError('not_found', 'Knowledge base not found')
  }
  return { ...knowledgeBase, workspaceId: knowledgeBase.workspaceId }
}

async function authorizeInternalKnowledgeBase(
  principal: SessionPrincipal,
  knowledgeBase: { workspaceId: string },
  operation: WorkspaceOperation
): Promise<void> {
  const context = await loadKnowledgeWorkspaceAuthorizationContext(knowledgeBase.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Knowledge base not found')
  await authorizeWorkspaceOperation(principal, operation, context)
}

async function executeListKnowledgeBases(args: {
  principal: Principal
  input: ListKnowledgeBasesInput
  context: KnowledgeWorkspaceContext
}): Promise<ListKnowledgeBasesResult> {
  /**
   * One index read serves both jobs: rendering each row's `folderPath` and
   * resolving the caller's `folderPath` filter to an id, so the filter costs no
   * second, lock-taking read of its own.
   */
  const index = await loadActiveFolderPathIndex(
    args.context.workspaceId,
    'knowledge_base',
    undefined,
    { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
  )
  const folderFilter = resolveFolderPathFilter(index, args.input.folderPath)
  if (folderFilter.kind === 'noMatch') {
    return {
      knowledgeBases: [],
      nextCursorKeys: null,
      sortBy: args.input.sortBy ?? 'createdAt',
      sortOrder: args.input.sortOrder ?? 'asc',
    }
  }
  const page = await getWorkspaceKnowledgeBases(args.context.workspaceId, args.input.scope, {
    folderId: folderFilter.kind === 'folder' ? folderFilter.folderId : undefined,
    search: args.input.search,
    sortBy: args.input.sortBy,
    sortOrder: args.input.sortOrder,
    limit: args.input.limit,
    cursorKeys: args.input.cursorKeys,
    access: await resolveKnowledgeAccessScope(args.principal, args.context),
  })
  return {
    knowledgeBases: page.data.map((knowledgeBase) => ({
      knowledgeBase,
      folderPath: knowledgeFolderPathForId(index, knowledgeBase.folderId),
    })),
    nextCursorKeys: page.nextCursorKeys,
    sortBy: args.input.sortBy ?? 'createdAt',
    sortOrder: args.input.sortOrder ?? 'asc',
  }
}

async function executeCreateKnowledgeBase(args: {
  principal: Parameters<typeof resolveKnowledgeAttributedUserId>[0]
  input: CreateKnowledgeBaseInput
  context: KnowledgeWorkspaceContext
}): Promise<KnowledgeBaseResult> {
  if (args.input.folderId !== undefined && args.input.folderPath !== undefined) {
    throw new OrchestrationError('validation', 'Specify either folderId or folderPath, not both')
  }
  const { folderId, index } =
    args.input.folderId !== undefined
      ? {
          folderId: args.input.folderId,
          index: await loadActiveFolderPathIndex(
            args.context.workspaceId,
            'knowledge_base',
            undefined,
            { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
          ),
        }
      : await resolveKnowledgeFolderPath(args.context.workspaceId, args.input.folderPath ?? '/')
  const chunkingConfig: ChunkingConfig = {
    ...DEFAULT_CHUNKING_CONFIG,
    ...args.input.chunkingConfig,
  }
  const { model: embeddingModel, dimensions: embeddingDimension } = await getConfiguredKbEmbedding()
  const knowledgeBase = await createAuthorizedKnowledgeBase(
    {
      name: args.input.name,
      isSearchIndex: args.input.isSearchIndex,
      description: args.input.description,
      workspaceId: args.context.workspaceId,
      folderId,
      userId: resolveKnowledgeAttributedUserId(args.principal, args.context),
      embeddingModel,
      embeddingDimension,
      chunkingConfig,
    },
    generateRequestId()
  )
  logger.info('Created knowledge base', {
    workspaceId: args.context.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    principalKind: args.principal.kind,
  })
  return { knowledgeBase, folderPath: knowledgeFolderPathForId(index, knowledgeBase.folderId) }
}

async function executeReadKnowledgeBase(args: {
  context: ActiveKnowledgeBaseContext
}): Promise<KnowledgeBaseResult> {
  const index = await loadActiveFolderPathIndex(
    args.context.workspaceId,
    'knowledge_base',
    undefined,
    { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
  )
  return {
    knowledgeBase: await attachKnowledgeBaseConnectors(
      args.context.knowledgeBase,
      await args.context.access.get()
    ),
    folderPath: knowledgeFolderPathForId(index, args.context.knowledgeBase.folderId),
  }
}

async function executeUpdateKnowledgeBase(args: {
  input: UpdateKnowledgeBaseInput
  context: ActiveKnowledgeBaseContext
}): Promise<KnowledgeBaseResult> {
  const updates = {
    name: args.input.name,
    description: args.input.description,
    chunkingConfig: args.input.chunkingConfig,
    folderId:
      args.input.folderPath === undefined
        ? undefined
        : (await resolveKnowledgeFolderPath(args.context.workspaceId, args.input.folderPath))
            .folderId,
  }
  if (Object.values(updates).every((value) => value === undefined)) {
    throw new OrchestrationError('validation', 'No updates specified')
  }
  const knowledgeBase = await updateKnowledgeBase(
    args.context.knowledgeBaseId,
    updates,
    generateRequestId(),
    { assertedWorkspaceId: args.context.workspaceId }
  )
  const index = await loadActiveFolderPathIndex(
    args.context.workspaceId,
    'knowledge_base',
    undefined,
    { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
  )
  logger.info('Updated knowledge base', {
    workspaceId: args.context.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
  })
  return {
    knowledgeBase: await attachKnowledgeBaseConnectors(
      knowledgeBase,
      await args.context.access.get()
    ),
    folderPath: knowledgeFolderPathForId(index, knowledgeBase.folderId),
  }
}

async function executeDeleteKnowledgeBase(args: {
  principal: Principal
  context: ActiveKnowledgeBaseContext
}): Promise<{ id: string; name: string }> {
  const allowSearchIndexDelete = await authorizeSearchIndexDeletion(
    args.principal,
    args.context,
    args.context.knowledgeBase
  )
  await deleteKnowledgeBase(args.context.knowledgeBaseId, generateRequestId(), {
    assertedWorkspaceId: args.context.workspaceId,
    allowSearchIndexDelete,
  })
  return { id: args.context.knowledgeBaseId, name: args.context.knowledgeBase.name }
}

export const listKnowledgeBases = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.list,
  resolveContext: ({ input }: { input: ListKnowledgeBasesInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  execute: executeListKnowledgeBases,
})

export const listKnowledgeBaseCatalog = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.list,
  resolveContext: ({ input }: { input: ListKnowledgeBasesInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }): Promise<ListKnowledgeBaseCatalogResult> {
    const result = await executeListKnowledgeBases({ principal, input, context })
    const knowledgeBaseIds = result.knowledgeBases.map(({ knowledgeBase }) => knowledgeBase.id)
    const tagDefinitions =
      knowledgeBaseIds.length === 0
        ? []
        : await db
            .select({
              id: knowledgeBaseTagDefinitions.id,
              knowledgeBaseId: knowledgeBaseTagDefinitions.knowledgeBaseId,
              tagSlot: knowledgeBaseTagDefinitions.tagSlot,
              displayName: knowledgeBaseTagDefinitions.displayName,
              fieldType: knowledgeBaseTagDefinitions.fieldType,
            })
            .from(knowledgeBaseTagDefinitions)
            .where(inArray(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseIds))
            .orderBy(knowledgeBaseTagDefinitions.tagSlot)
    const tagsByKnowledgeBase = new Map<string, KnowledgeBaseCatalogTagDefinition[]>()
    for (const definition of tagDefinitions) {
      const existing = tagsByKnowledgeBase.get(definition.knowledgeBaseId)
      if (existing) existing.push(definition)
      else tagsByKnowledgeBase.set(definition.knowledgeBaseId, [definition])
    }
    return {
      knowledgeBases: result.knowledgeBases.map((entry) => ({
        ...entry,
        tagDefinitions: tagsByKnowledgeBase.get(entry.knowledgeBase.id) ?? [],
      })),
    }
  },
})

/**
 * Un-archives a knowledge base and reports it as it now stands.
 *
 * Idempotent: a knowledge base that is already active is returned unchanged,
 * with no restore performed and no audit entry recorded. A `409` there would
 * make a retry after a dropped response look like a failure, and restore has no
 * state a second call could corrupt.
 *
 * Suppresses orchestration audit so the application projects one entry from
 * the authoritative result.
 */
export const restoreKnowledgeBase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.restore,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: RestoreKnowledgeBaseInput
  }) =>
    resolveArchivedKnowledgeBaseContext({
      knowledgeBaseId: input.knowledgeBaseId,
      assertedWorkspaceId: input.assertedWorkspaceId,
    }),
  async execute({ principal, input, context, request }): Promise<RestoreKnowledgeBaseResult> {
    const restored = context.restorableKnowledgeBase.deletedAt !== null
    if (restored) {
      const outcome = await performRestoreKnowledgeBase({
        knowledgeBaseId: context.knowledgeBaseId,
        userId: resolveKnowledgeAttributedUserId(principal, context),
        source: input.source,
        recordSemanticAudit: false,
        ...(request ? { request } : {}),
      })
      if (!outcome.success) {
        throwKnowledgeOrchestrationFailure(outcome, 'Failed to restore knowledge base')
      }
    }
    const knowledgeBase = await getKnowledgeBaseById(context.knowledgeBaseId)
    if (!knowledgeBase) throw new OrchestrationError('not_found', 'Knowledge base not found')
    const index = await loadActiveFolderPathIndex(
      context.workspaceId,
      'knowledge_base',
      undefined,
      { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
    )
    return {
      knowledgeBase: await attachKnowledgeBaseConnectors(
        knowledgeBase,
        await resolveKnowledgeAccessScope(principal, context)
      ),
      folderPath: knowledgeFolderPathForId(index, knowledgeBase.folderId),
      restored,
    }
  },
  projectAudit: ({ input, result }) =>
    result.restored
      ? [
          {
            action: AuditAction.KNOWLEDGE_BASE_RESTORED,
            resourceType: AuditResourceType.KNOWLEDGE_BASE,
            resourceId: result.knowledgeBase.id,
            resourceName: result.knowledgeBase.name,
            description: `Restored knowledge base "${result.knowledgeBase.name}"`,
            metadata: {
              source: input.source,
              knowledgeBaseName: result.knowledgeBase.name,
            },
          },
        ]
      : [],
})

export const listInternalKnowledgeBases = {
  operation: knowledgeSessionOperations.list,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: ListInternalKnowledgeBasesInput
  }): Promise<ListInternalKnowledgeBasesResult> {
    if (principal.kind !== 'session') {
      throw new PrincipalKindAuthorizationError(principal.kind, knowledgeSessionOperations.list.id)
    }
    if (input.workspaceId === undefined) {
      return { knowledgeBases: [] }
    }
    const context = await resolveKnowledgeWorkspaceContext({ workspaceId: input.workspaceId })
    await authorizeWorkspaceOperation(principal, knowledgeOperations.list, context)
    const { data: knowledgeBases } = await getWorkspaceKnowledgeBases(
      context.workspaceId,
      input.scope,
      { access: await resolveKnowledgeAccessScope(principal, context) }
    )
    return { knowledgeBases }
  },
} satisfies OperationUseCase<
  (typeof knowledgeSessionOperations)['list'],
  ListInternalKnowledgeBasesInput,
  ListInternalKnowledgeBasesResult
>

export const createKnowledgeBase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.create,
  resolveContext: ({ input }: { input: CreateKnowledgeBaseInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  execute: executeCreateKnowledgeBase,
  projectAudit: ({ input, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_CREATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.knowledgeBase.id,
    resourceName: result.knowledgeBase.name,
    description: `Created knowledge base "${result.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      name: result.knowledgeBase.name,
      description: result.knowledgeBase.description,
      embeddingModel: result.knowledgeBase.embeddingModel,
      embeddingDimension: result.knowledgeBase.embeddingDimension,
      folderPath: result.folderPath,
    },
  }),
})

export const readKnowledgeBase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.read,
  resolveContext: ({ principal, input }: { principal: Principal; input: ReadKnowledgeBaseInput }) =>
    resolveActiveKnowledgeBaseContext(input, principal),
  execute: executeReadKnowledgeBase,
})

export const updateKnowledgeBaseOperation = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.update,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateKnowledgeBaseInput
  }) => resolveActiveKnowledgeBaseContext(input, principal),
  execute: executeUpdateKnowledgeBase,
  projectAudit: ({ input, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.knowledgeBase.id,
    resourceName: result.knowledgeBase.name,
    description: `Updated knowledge base "${result.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      updatedFields: ['name', 'description', 'chunkingConfig', 'folderPath'].filter(
        (key) => input[key as keyof UpdateKnowledgeBaseInput] !== undefined
      ),
    },
  }),
})

export const deleteKnowledgeBaseOperation = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.delete,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: DeleteKnowledgeBaseInput
  }) => resolveActiveKnowledgeBaseContext(input, principal),
  execute: executeDeleteKnowledgeBase,
  projectAudit: ({ input, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_DELETED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Deleted knowledge base "${result.name}"`,
    metadata: { source: input.source, knowledgeBaseName: result.name },
  }),
})

export const bulkDeleteKnowledgeBases = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.bulkDelete,
  async resolveContext({
    input,
  }: {
    input: BulkDeleteKnowledgeBasesInput
  }): Promise<BulkDeleteKnowledgeBasesContext> {
    const knowledgeBaseIds = requireBoundedKnowledgeBatch(
      input.knowledgeBaseIds,
      'knowledge base IDs',
      BULK_DELETE_KNOWLEDGE_BASES_COST_POLICY.maxItems
    )
    return {
      ...(await resolveKnowledgeWorkspaceContext({ workspaceId: input.assertedWorkspaceId })),
      knowledgeBaseIds,
    }
  },
  async execute({ principal, input, context }): Promise<BulkDeleteKnowledgeBasesExecutionResult> {
    const deleted: BulkDeleteKnowledgeBasesResult['deleted'] = []
    const notFound: string[] = []
    const failed: BulkDeleteKnowledgeBasesResult['failed'] = []
    let terminalFailure: KnowledgeBatchExecutionResult['terminalFailure']

    for (const knowledgeBaseId of context.knowledgeBaseIds) {
      if (input.cancellationSignal?.aborted) break
      let knowledgeBaseName = knowledgeBaseId
      try {
        const canonical = await resolveActiveKnowledgeBaseContext(
          {
            knowledgeBaseId,
            assertedWorkspaceId: context.workspaceId,
          },
          principal
        )
        knowledgeBaseName = canonical.knowledgeBase.name
        await authorizeWorkspaceOperation(principal, knowledgeOperations.bulkDelete, canonical, {
          delegation: knowledgeDelegationPolicy,
        })
        if (input.cancellationSignal?.aborted) break
        deleted.push(await executeDeleteKnowledgeBase({ principal, context: canonical }))
      } catch (error) {
        const disposition = classifyBulkItemError(error)
        if (disposition.kind === 'notFound') {
          notFound.push(knowledgeBaseId)
          continue
        }
        if (disposition.kind === 'failed') {
          failed.push({
            id: knowledgeBaseId,
            name: knowledgeBaseName,
            reason: disposition.reason,
          })
          continue
        }
        terminalFailure = { error: disposition.error }
        break
      }
    }

    return {
      deleted,
      notFound,
      failed,
      cancelled: input.cancellationSignal?.aborted ?? false,
      ...(terminalFailure && { terminalFailure }),
    }
  },
  projectAudit: ({ input, result }) =>
    result.deleted.map((knowledgeBase) => ({
      action: AuditAction.KNOWLEDGE_BASE_DELETED,
      resourceType: AuditResourceType.KNOWLEDGE_BASE,
      resourceId: knowledgeBase.id,
      resourceName: knowledgeBase.name,
      description: `Deleted knowledge base "${knowledgeBase.name}"`,
      metadata: { source: input.source, knowledgeBaseName: knowledgeBase.name },
    })),
  afterSuccess: ({ result }) => {
    try {
      for (const knowledgeBase of result.deleted) {
        PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: knowledgeBase.id })
      }
    } finally {
      rethrowKnowledgeBatchTerminalFailure(result)
    }
  },
})

export const readInternalKnowledgeBase = {
  operation: knowledgeSessionOperations.read,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadInternalKnowledgeBaseInput
  }): Promise<InternalKnowledgeBaseResult> {
    requireSessionPrincipal(principal, knowledgeSessionOperations.read.id)
    const knowledgeBase = await loadInternalActiveKnowledgeBase(input.knowledgeBaseId)
    await authorizeInternalKnowledgeBase(principal, knowledgeBase, knowledgeOperations.read)
    return {
      knowledgeBase: await attachKnowledgeBaseConnectors(
        knowledgeBase,
        await resolveKnowledgeAccessScope(principal, {
          workspaceId: knowledgeBase.workspaceId,
        })
      ),
    }
  },
} satisfies OperationUseCase<
  (typeof knowledgeSessionOperations)['read'],
  ReadInternalKnowledgeBaseInput,
  InternalKnowledgeBaseResult
>

export const updateInternalKnowledgeBase = {
  operation: knowledgeSessionOperations.update,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: UpdateInternalKnowledgeBaseInput
    request?: { headers: { get(name: string): string | null } }
  }): Promise<InternalKnowledgeBaseResult> {
    requireSessionPrincipal(principal, knowledgeSessionOperations.update.id)
    const knowledgeBase = await loadInternalActiveKnowledgeBase(input.knowledgeBaseId)
    await authorizeInternalKnowledgeBase(principal, knowledgeBase, knowledgeOperations.update)

    if (input.workspaceId !== undefined && !input.workspaceId) {
      throw new OrchestrationError('validation', 'Workspace ID is required')
    }

    if (input.workspaceId !== undefined && input.workspaceId !== knowledgeBase.workspaceId) {
      const destination = await resolveKnowledgeWorkspaceContext({
        workspaceId: input.workspaceId,
      })
      await authorizeWorkspaceOperation(principal, knowledgeOperations.update, destination)
    }

    const outcome = await performUpdateKnowledgeBase({
      knowledgeBaseId: knowledgeBase.id,
      workspaceId: knowledgeBase.workspaceId,
      assertedWorkspaceId: knowledgeBase.workspaceId,
      userId: principal.userId,
      source: 'ui',
      updates: {
        name: input.name,
        description: input.description,
        workspaceId: input.workspaceId,
        folderId: input.folderId,
        chunkingConfig: input.chunkingConfig,
      },
      request,
    })
    if (!outcome.success) {
      throwKnowledgeOrchestrationFailure(outcome, 'Failed to update knowledge base')
    }
    return {
      knowledgeBase: await attachKnowledgeBaseConnectors(
        outcome.knowledgeBase,
        await resolveKnowledgeAccessScope(principal, {
          workspaceId: outcome.knowledgeBase.workspaceId ?? undefined,
        })
      ),
    }
  },
} satisfies OperationUseCase<
  (typeof knowledgeSessionOperations)['update'],
  UpdateInternalKnowledgeBaseInput,
  InternalKnowledgeBaseResult
>

export const deleteInternalKnowledgeBase = {
  operation: knowledgeSessionOperations.delete,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: ReadInternalKnowledgeBaseInput
    request?: { headers: { get(name: string): string | null } }
  }): Promise<{ success: true }> {
    requireSessionPrincipal(principal, knowledgeSessionOperations.delete.id)
    const knowledgeBase = await loadInternalActiveKnowledgeBase(input.knowledgeBaseId)
    await authorizeInternalKnowledgeBase(principal, knowledgeBase, knowledgeOperations.delete)
    const allowSearchIndexDelete = await authorizeSearchIndexDeletion(
      principal,
      await resolveKnowledgeWorkspaceContext({ workspaceId: knowledgeBase.workspaceId }),
      knowledgeBase
    )
    const outcome = await performDeleteKnowledgeBase({
      allowSearchIndexDelete,
      knowledgeBase: {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        workspaceId: knowledgeBase.workspaceId,
      },
      assertedWorkspaceId: knowledgeBase.workspaceId,
      userId: principal.userId,
      source: 'ui',
      request,
    })
    if (!outcome.success) {
      throwKnowledgeOrchestrationFailure(outcome, 'Failed to delete knowledge base')
    }
    return { success: true }
  },
} satisfies OperationUseCase<
  (typeof knowledgeSessionOperations)['delete'],
  ReadInternalKnowledgeBaseInput,
  { success: true }
>

export const restoreInternalKnowledgeBase = {
  operation: knowledgeSessionOperations.restore,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: RestoreInternalKnowledgeBaseInput
    request?: { headers: { get(name: string): string | null } }
  }): Promise<{ success: true }> {
    requireSessionPrincipal(principal, knowledgeSessionOperations.restore.id)
    await restoreKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: input.knowledgeBaseId, source: 'ui' },
      ...(request ? { request } : {}),
    })
    return { success: true }
  },
} satisfies OperationUseCase<
  (typeof knowledgeSessionOperations)['restore'],
  RestoreInternalKnowledgeBaseInput,
  { success: true }
>
