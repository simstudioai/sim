import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createResourceVfsFolders,
  deleteResourceVfsFolders,
  type FolderedResourceAdapter,
  resolveResourceRowBySegments,
  transferResourceVfsItems,
} from '@/lib/folders/application/resource-vfs'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  type KnowledgeWorkspaceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { authorizeSearchIndexDeletion } from '@/lib/knowledge/application/knowledge-base-access'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  deleteKnowledgeBase,
  findActiveKnowledgeBasesByExactName,
  getWorkspaceKnowledgeBases,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'

interface KnowledgeVfsReferenceInput {
  workspaceId: string
  sourceName: string
  /** Folder segments + leaf name; when present the nested-aware resolver is used. */
  sourceSegments?: string[]
}

const knowledgeVfsAdapter: FolderedResourceAdapter = {
  resourceType: 'knowledge_base',
  rootSegment: 'knowledgebases',
  label: 'knowledge base',
  async listRows(workspaceId) {
    const { data: rows } = await getWorkspaceKnowledgeBases(workspaceId, 'active', {})
    return rows.map((kb) => ({ id: kb.id, name: kb.name, folderId: kb.folderId ?? null }))
  },
  async moveRow(row, folderId, workspaceId) {
    await updateKnowledgeBase(row.id, { folderId }, generateRequestId(), {
      assertedWorkspaceId: workspaceId,
    })
  },
  async renameRow(row, newName, workspaceId) {
    const updated = await updateKnowledgeBase(row.id, { name: newName }, generateRequestId(), {
      assertedWorkspaceId: workspaceId,
    })
    return { id: updated.id, name: updated.name }
  },
}

export interface RenameKnowledgeBaseByVfsPathInput extends KnowledgeVfsReferenceInput {
  newName: string
}

export type DeleteKnowledgeBaseByVfsPathInput = KnowledgeVfsReferenceInput

async function resolveKnowledgeBaseByVfsName(
  context: KnowledgeWorkspaceContext,
  sourceName: string,
  sourceSegments?: string[]
): Promise<Omit<KnowledgeBaseWithCounts, 'connectorTypes' | 'hasPermissionScopedConnector'>> {
  if (sourceSegments && sourceSegments.length > 1) {
    const row = await resolveResourceRowBySegments(
      knowledgeVfsAdapter,
      context.workspaceId,
      sourceSegments
    )
    /**
     * Resolved by folder path, so the name may be shared with knowledge bases in
     * other folders. The exact-name lookup caps its result set, so the full list
     * is read here and narrowed by id instead.
     */
    const { data: rows } = await getWorkspaceKnowledgeBases(context.workspaceId, 'active', {
      search: row.name,
    })
    const match = rows.find((kb) => kb.id === row.id)
    if (!match) {
      throw new OrchestrationError(
        'not_found',
        `Knowledge base not found at knowledgebases/${sourceSegments.join('/')}`
      )
    }
    return match
  }
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
    const knowledgeBase = await resolveKnowledgeBaseByVfsName(
      context,
      input.sourceName,
      input.sourceSegments
    )
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
  async execute({ principal, input, context }) {
    const knowledgeBase = await resolveKnowledgeBaseByVfsName(
      context,
      input.sourceName,
      input.sourceSegments
    )
    const allowSearchIndexDelete = await authorizeSearchIndexDeletion(
      principal,
      context,
      knowledgeBase
    )
    await deleteKnowledgeBase(knowledgeBase.id, generateRequestId(), {
      allowSearchIndexDelete,
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

export interface KnowledgeVfsPathsInput {
  workspaceId: string
  paths: Array<{ source: string; segments: string[] }>
}

export interface TransferKnowledgeVfsItemsInput {
  workspaceId: string
  sources: Array<{ source: string; segments: string[] }>
  destination: { segments: string[]; trailingSlash: boolean }
}

/** mkdir -p under knowledgebases/ — folder invariants live in lib/folders. */
export const createKnowledgeVfsFolders = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.manageVfsFolders,
  resolveContext: ({ input }: { input: KnowledgeVfsPathsInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }) {
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes = await createResourceVfsFolders(knowledgeVfsAdapter, {
      workspaceId: context.workspaceId,
      userId,
      paths: input.paths,
    })
    return { outcomes, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.workspaceId,
    resourceName: 'knowledgebases',
    description: 'Created knowledge base folders',
    metadata: { op: 'vfs_mkdir', count: result.outcomes.length, source: 'copilot_vfs' },
  }),
})

/** mv under knowledgebases/: rows into folders, folder moves/renames, leaf renames. */
export const transferKnowledgeVfsItems = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.moveByVfsPath,
  resolveContext: ({ input }: { input: TransferKnowledgeVfsItemsInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }) {
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes = await transferResourceVfsItems(knowledgeVfsAdapter, {
      workspaceId: context.workspaceId,
      userId,
      sources: input.sources,
      destination: input.destination,
    })
    return { outcomes, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_UPDATED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.workspaceId,
    resourceName: 'knowledgebases',
    description: 'Moved knowledge base VFS items',
    metadata: { op: 'vfs_mv', count: result.outcomes.length, source: 'copilot_vfs' },
  }),
})

/** rm of knowledgebases/ folder paths — recursive via the shared cascade. */
export const deleteKnowledgeVfsFolders = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.manageVfsFolders,
  resolveContext: ({ input }: { input: KnowledgeVfsPathsInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, input, context }) {
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const outcomes = await deleteResourceVfsFolders(knowledgeVfsAdapter, {
      workspaceId: context.workspaceId,
      userId,
      paths: input.paths,
    })
    return { outcomes, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_DELETED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.workspaceId,
    resourceName: 'knowledgebases',
    description: 'Deleted knowledge base folders',
    metadata: { op: 'vfs_rm_folder', count: result.outcomes.length, source: 'copilot_vfs' },
  }),
})
