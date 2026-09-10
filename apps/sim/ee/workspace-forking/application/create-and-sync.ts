import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { generateShortId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  withWorkspaceOperationReplay,
  workflowOperationFingerprint,
} from '@/lib/workspaces/operations/receipts'
import { getWorkspaceCreationPolicy } from '@/lib/workspaces/policy'
import {
  defineForkUseCase,
  type ForkApplicationContext,
} from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { previewForkSync, type SyncChoices } from '@/ee/workspace-forking/application/preview-sync'
import { loadForkPreviewRevision } from '@/ee/workspace-forking/application/revision'
import { loadSourceDeployedStates } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import { createFork, type ForkResourceSelection } from '@/ee/workspace-forking/lib/create-fork'
import { type PromoteForkParams, promoteFork } from '@/ee/workspace-forking/lib/promote/promote'

export interface ForkInput {
  workspaceId: string
  name?: string
  copy?: Partial<ForkResourceSelection>
  requestId?: string
  previewFingerprint?: string
}
export interface SyncInput extends SyncChoices {
  dependentValues?: PromoteForkParams['dependentValues']
  workspaceId: string
  otherWorkspaceId: string
  direction: 'push' | 'pull'
  requestId?: string
  previewFingerprint?: string
}

async function loadActorName(userId: string): Promise<string | undefined> {
  const [actor] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return actor?.name ?? undefined
}

function forkChoices(input: ForkInput) {
  return {
    name: input.name,
    copy: input.copy
      ? {
          files: input.copy.files ?? [],
          tables: input.copy.tables ?? [],
          knowledgeBases: input.copy.knowledgeBases ?? [],
          customTools: input.copy.customTools ?? [],
          skills: input.copy.skills ?? [],
          mcpServers: input.copy.mcpServers ?? [],
          workflowMcpServers: input.copy.workflowMcpServers ?? [],
        }
      : undefined,
  }
}

function syncChoices(input: SyncInput) {
  return {
    otherWorkspaceId: input.otherWorkspaceId,
    direction: input.direction,
    mappings: input.mappings,
    sourceDependentValues: input.sourceDependentValues,
    copyResources: input.copyResources,
    dropReferences: input.dropReferences,
    triggerMappings: input.triggerMappings,
  }
}

function syncContext(input: SyncInput, context: ForkApplicationContext) {
  if (!context.edge || !context.other) throw new Error('Sync requires an authorized fork edge')
  return {
    edge: context.edge,
    sourceWorkspaceId: input.direction === 'push' ? context.workspace.id : context.other.id,
    targetWorkspaceId: input.direction === 'push' ? context.other.id : context.workspace.id,
    direction: input.direction,
  }
}

async function creationPolicy(workspace: ForkApplicationContext['workspace'], userId: string) {
  const policy = await getWorkspaceCreationPolicy({
    userId,
    activeOrganizationId: workspace.organizationId,
    pinOrganization: true,
  })
  if (!policy.canCreate)
    throw new OrchestrationError(
      policy.status === 403 ? 'forbidden' : 'validation',
      policy.reason ?? 'Workspace creation is not permitted'
    )
  return policy
}

export const previewWorkspaceFork = defineForkUseCase({
  operation: forkOperations.preview,
  async execute({
    principal,
    input,
    context,
  }: {
    principal: { userId: string }
    input: ForkInput
    context: ForkApplicationContext
  }) {
    await creationPolicy(context.workspace, principal.userId)
    const revision = await loadForkPreviewRevision(
      db,
      { sourceWorkspaceId: context.workspaceId },
      forkChoices(input)
    )
    const { deployedWorkflows } = await loadSourceDeployedStates(context.workspaceId)
    return {
      previewFingerprint: revision.fingerprint,
      sourceWorkspaceId: context.workspaceId,
      workflows: deployedWorkflows.map((item) => ({ sourceWorkflowId: item.id, name: item.name })),
      selectedResourceCount: Object.values(input.copy ?? {}).reduce(
        (count, ids) => count + (ids?.length ?? 0),
        0
      ),
      draftOnly: true as const,
    }
  },
})

export const forkWorkspace = defineForkUseCase<
  typeof forkOperations.create,
  ForkInput,
  Awaited<ReturnType<typeof createFork>>
>({
  operation: forkOperations.create,
  async execute({ principal, input, context, request }) {
    const choices = forkChoices(input)
    const admission =
      input.requestId && input.previewFingerprint
        ? {
            workspaceId: context.workspaceId,
            requestId: input.requestId,
            previewFingerprint: input.previewFingerprint,
            choices,
            requestHash: workflowOperationFingerprint({
              operation: 'workspace_fork',
              workspaceId: context.workspaceId,
              choices,
              previewFingerprint: input.previewFingerprint,
            }),
          }
        : undefined
    if ((input.requestId || input.previewFingerprint) && !admission)
      throw new OrchestrationError(
        'validation',
        'requestId and previewFingerprint are required together'
      )
    const apply = async () => {
      const policy = await creationPolicy(context.workspace, principal.userId)
      return createFork({
        source: context.workspace,
        policy,
        userId: principal.userId,
        actorName: await loadActorName(principal.userId),
        name: input.name,
        selection: choices.copy,
        requestId: input.requestId ?? request?.headers.get('x-request-id') ?? generateShortId(),
        admission,
      })
    }
    return admission
      ? withWorkspaceOperationReplay(
          admission,
          (receipt) => {
            if (!receipt.forkResult)
              throw new OrchestrationError('internal', 'Fork receipt is missing its result')
            return { ...receipt.forkResult, operation: receipt, replayed: true }
          },
          apply
        )
      : apply()
  },
  projectAudit: ({ context, result }) =>
    result.replayed
      ? []
      : {
          workspaceId: result.workspace.id,
          action: AuditAction.WORKSPACE_FORKED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: result.workspace.id,
          resourceName: result.workspace.name,
          description: `Forked workspace from "${context.workspace.name}"`,
          metadata: {
            parentWorkspaceId: context.workspaceId,
            workflowsCopied: result.workflowsCopied,
          },
        },
})

export const previewWorkspaceSync = defineForkUseCase({
  operation: forkOperations.syncPreview,
  bothSides: true,
  edge: true,
  execute: ({
    input,
    context,
    principal,
  }: {
    input: SyncInput
    context: ForkApplicationContext
    principal: Principal
  }) =>
    previewForkSync(
      { ...syncContext(input, context), ...syncChoices(input) },
      syncChoices(input),
      principal
    ),
})

export const syncWorkspace = defineForkUseCase<
  typeof forkOperations.sync,
  SyncInput,
  Awaited<ReturnType<typeof promoteFork>>
>({
  operation: forkOperations.sync,
  bothSides: true,
  edge: true,
  async execute({ principal, input, context, request }) {
    const choices = syncChoices(input)
    const admission =
      input.requestId && input.previewFingerprint
        ? {
            workspaceId: context.workspaceId,
            requestId: input.requestId,
            previewFingerprint: input.previewFingerprint,
            choices,
            requestHash: workflowOperationFingerprint({
              operation: 'workspace_sync',
              workspaceId: context.workspaceId,
              choices,
              previewFingerprint: input.previewFingerprint,
            }),
          }
        : undefined
    if ((input.requestId || input.previewFingerprint) && !admission)
      throw new OrchestrationError(
        'validation',
        'requestId and previewFingerprint are required together'
      )
    const apply = async () => {
      if (admission)
        await previewForkSync({ ...syncContext(input, context), ...choices }, choices, principal)
      return promoteFork({
        ...syncContext(input, context),
        ...choices,
        dependentValues: input.dependentValues,
        userId: principal.userId,
        actorName: await loadActorName(principal.userId),
        otherWorkspaceName: context.other!.name,
        requestId: input.requestId ?? request?.headers.get('x-request-id') ?? generateShortId(),
        admission,
      })
    }
    return admission
      ? withWorkspaceOperationReplay(
          admission,
          (receipt) => {
            if (!receipt.syncResult)
              throw new OrchestrationError('internal', 'Sync receipt is missing its result')
            return { ...receipt.syncResult, operation: receipt, replayed: true }
          },
          apply
        )
      : apply()
  },
  projectAudit: ({ input, context, result }) =>
    result.replayed || result.blocked
      ? []
      : {
          workspaceId: syncContext(input, context).targetWorkspaceId,
          action: AuditAction.WORKSPACE_FORK_PROMOTED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: syncContext(input, context).targetWorkspaceId,
          resourceName: input.direction === 'push' ? context.other!.name : context.workspace.name,
          metadata: {
            otherWorkspaceId: input.otherWorkspaceId,
            direction: input.direction,
            updated: result.updated,
            created: result.created,
            archived: result.archived,
          },
        },
})
