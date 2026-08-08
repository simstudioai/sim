import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeBaseContext,
  type KnowledgeWorkspaceContext,
  resolveActiveKnowledgeBaseContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import {
  knowledgeFolderPathForId,
  resolveKnowledgeFolderPath,
} from '@/lib/knowledge/application/folder-paths'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  DEFAULT_CHUNKING_CONFIG,
  MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE,
} from '@/lib/knowledge/constants'
import { EMBEDDING_DIMENSIONS, getConfiguredEmbeddingModel } from '@/lib/knowledge/embeddings'
import {
  createAuthorizedKnowledgeBase,
  deleteKnowledgeBase,
  getWorkspaceKnowledgeBases,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import type { ChunkingConfig, KnowledgeBaseWithCounts } from '@/lib/knowledge/types'

const logger = createLogger('KnowledgeBaseApplication')

export interface ListKnowledgeBasesInput {
  workspaceId: string
  folderPath?: string
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface KnowledgeBaseResult {
  knowledgeBase: KnowledgeBaseWithCounts
  folderPath: string
}

export interface ListKnowledgeBasesResult {
  knowledgeBases: KnowledgeBaseResult[]
}

export interface CreateKnowledgeBaseInput {
  workspaceId: string
  name: string
  description?: string
  chunkingConfig?: Partial<ChunkingConfig>
  folderPath?: string
  source?: string
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

async function executeListKnowledgeBases(args: {
  input: ListKnowledgeBasesInput
  context: KnowledgeWorkspaceContext
}): Promise<ListKnowledgeBasesResult> {
  const index = await loadActiveFolderPathIndex(
    args.context.workspaceId,
    'knowledge_base',
    undefined,
    { maxRows: MAX_KNOWLEDGE_FOLDERS_PER_WORKSPACE }
  )
  const folderId =
    args.input.folderPath === undefined
      ? undefined
      : await resolveKnowledgeFolderPath(args.context.workspaceId, args.input.folderPath).then(
          (resolved) => resolved.folderId
        )
  const rows = await getWorkspaceKnowledgeBases(args.context.workspaceId, 'active', {
    folderId,
    search: args.input.search,
    sortBy: args.input.sortBy,
    sortOrder: args.input.sortOrder,
  })
  return {
    knowledgeBases: rows.map((knowledgeBase) => ({
      knowledgeBase,
      folderPath: knowledgeFolderPathForId(index, knowledgeBase.folderId),
    })),
  }
}

async function executeCreateKnowledgeBase(args: {
  principal: Parameters<typeof resolveKnowledgeAttributedUserId>[0]
  input: CreateKnowledgeBaseInput
  context: KnowledgeWorkspaceContext
}): Promise<KnowledgeBaseResult> {
  const path = args.input.folderPath ?? '/'
  const { folderId, index } = await resolveKnowledgeFolderPath(args.context.workspaceId, path)
  const chunkingConfig: ChunkingConfig = {
    ...DEFAULT_CHUNKING_CONFIG,
    ...args.input.chunkingConfig,
  }
  const knowledgeBase = await createAuthorizedKnowledgeBase(
    {
      name: args.input.name,
      description: args.input.description,
      workspaceId: args.context.workspaceId,
      folderId,
      userId: resolveKnowledgeAttributedUserId(args.principal, args.context),
      embeddingModel: getConfiguredEmbeddingModel(),
      embeddingDimension: EMBEDDING_DIMENSIONS,
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
    knowledgeBase: args.context.knowledgeBase,
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
  return { knowledgeBase, folderPath: knowledgeFolderPathForId(index, knowledgeBase.folderId) }
}

async function executeDeleteKnowledgeBase(args: {
  context: ActiveKnowledgeBaseContext
}): Promise<{ id: string; name: string }> {
  await deleteKnowledgeBase(args.context.knowledgeBaseId, generateRequestId(), {
    assertedWorkspaceId: args.context.workspaceId,
  })
  return { id: args.context.knowledgeBaseId, name: args.context.knowledgeBase.name }
}

export const listKnowledgeBases = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.list,
  resolveContext: ({ input }: { input: ListKnowledgeBasesInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  execute: executeListKnowledgeBases,
})

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
  resolveContext: ({ input }: { input: ReadKnowledgeBaseInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  execute: executeReadKnowledgeBase,
})

export const updateKnowledgeBaseOperation = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.update,
  resolveContext: ({ input }: { input: UpdateKnowledgeBaseInput }) =>
    resolveActiveKnowledgeBaseContext(input),
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
  resolveContext: ({ input }: { input: DeleteKnowledgeBaseInput }) =>
    resolveActiveKnowledgeBaseContext(input),
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
