import type { Principal } from '@sim/auth/principal'
import type { SourceBase, WorkflowLockV1 } from '@sim/workflow-code'
import type { DbTransaction } from '@/lib/db/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveWorkflowFolderPath } from '@/lib/workflows/application/folders'
import {
  requireMutableFolder,
  requireMutableWorkflow,
} from '@/lib/workflows/application/mutability'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { recordSourceRefused } from '@/lib/workflows/application/source-analytics'
import { commitSource } from '@/lib/workflows/application/source-pipeline/commit'
import {
  afterSourceApply,
  afterSourceCreate,
  type SourceProvenance,
  sourceAnalyticsFacts,
  sourceApplyAudit,
  sourceCreateAudit,
} from '@/lib/workflows/application/source-pipeline/effects'
import type { PendingResource } from '@/lib/workflows/application/source-pipeline/evaluate'
import {
  EMPTY_LOCK,
  type SourceLoads,
  type SourceTarget,
} from '@/lib/workflows/application/source-pipeline/load'
import type { SourceOutcome } from '@/lib/workflows/application/source-pipeline/outcome'
import {
  type PlannedSource,
  planForCommit,
  planSource,
  type RefusedSource,
} from '@/lib/workflows/application/source-pipeline/plan'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'

/** An update of a stored workflow's draft, as a workspace source apply plans it. */
interface UpdatePlanInput {
  workflowId: string
  files: Record<string, string>
  lock: WorkflowLockV1
  base: SourceBase
  allowDelete: boolean
  /** The resources the workspace apply creates or adopts first, which the evaluation resolves. */
  pendingResources: readonly PendingResource[]
  /** Loads shared by every workflow the workspace apply evaluates. */
  loads: SourceLoads
}

/** A workflow a workspace source apply creates, under the id it minted for it. */
interface CreatePlanInput {
  workspaceId: string
  workflowId: string
  files: Record<string, string>
  pendingResources: readonly PendingResource[]
  loads: SourceLoads
}

/** The update target of a stored workflow's plan, under the workflow context resolved now. */
function updateTarget(
  context: ActiveWorkflowApplicationContext,
  input: Pick<UpdatePlanInput, 'base' | 'allowDelete'>
): SourceTarget {
  return { kind: 'existing', context, base: input.base, allowDelete: input.allowDelete }
}

/** The create target of a new workflow's plan, at the workspace root. */
async function createTarget(
  workspace: ActiveWorkspaceApplicationContext,
  workflowId: string
): Promise<Extract<SourceTarget, { kind: 'new' }>> {
  const { folderId } = await resolveWorkflowFolderPath(workspace.workspaceId, '/')
  await requireMutableFolder(folderId)
  return { kind: 'new', workspace, workflowId, create: {}, folderId }
}

/**
 * A workspace source apply's update of one stored workflow, in two steps under the apply
 * operation's authorization, feature flag and mutability checks: `plan` evaluates the folder
 * without writing and records nothing; `commit` writes that plan (or, when the plan resolved a
 * stand-in id of a resource the apply has since created, plans it again first), re-checking the
 * fingerprint under the workflow row lock, and audits, records and notifies exactly as
 * `applyWorkflowSource` does.
 */
export const workflowSourceUpdate = {
  plan: defineAuthorizedWorkflowUseCase({
    operation: workflowOperations.applySource,
    resolveContext: resolvePrincipalWorkflowContext<UpdatePlanInput>,
    async execute({ principal, input, context }): Promise<PlannedSource | RefusedSource> {
      await requireMutableWorkflow(context.workflowId)
      return planSource(
        principal,
        updateTarget(context, input),
        { files: input.files, lock: input.lock, pendingResources: input.pendingResources },
        { loads: input.loads, allocate: false }
      )
    },
  }),
  commit: defineAuthorizedWorkflowUseCase({
    operation: workflowOperations.applySource,
    resolveContext: ({ principal, input }: { principal: Principal; input: CommitInput }) =>
      resolvePrincipalWorkflowContext({
        principal,
        input: { workflowId: input.planned.workflowId },
      }),
    async execute({ principal, input, context }): Promise<SourceOutcome> {
      const facts = sourceAnalyticsFacts(
        principal,
        input.provenance,
        'apply',
        context.workspaceId,
        false
      )
      try {
        await requireMutableWorkflow(context.workflowId)
        const { planned } = input
        if (planned.target.kind !== 'existing') {
          throw new Error('An update commits a plan made for a stored workflow')
        }
        const target: SourceTarget = { ...planned.target, context }
        return await commitSource(principal, await planForCommit(principal, planned, target), {
          kind: 'existing',
          context,
        })
      } catch (error) {
        recordSourceRefused({ ...facts, workflowId: context.workflowId }, error)
        throw error
      }
    },
    projectAudit: ({ principal, input, context, result }) =>
      sourceApplyAudit(principal, input.provenance, context.workflowId, result),
    afterSuccess: ({ principal, input, context, result }) =>
      afterSourceApply(principal, input.provenance, context, result),
  }),
}

/** What a workspace source apply commits: a plan its `plan` step made. */
interface CommitInput {
  planned: PlannedSource
  provenance?: SourceProvenance
}

/** What a workspace source apply commits for a workflow it creates. */
interface CreateCommitInput extends CommitInput {
  /** Runs inside the create's transaction, so what it writes commits with the workflow. */
  withinCreate: (tx: DbTransaction, workflowId: string) => Promise<void>
}

/**
 * A workspace source apply's create of one workflow under the id it minted, in two steps under
 * the create operation's authorization, feature flag and folder mutability checks: `plan`
 * evaluates the folder and checks its name is free, recording nothing; `commit` writes the plan
 * (planning again first when it must, as {@link workflowSourceUpdate} does) in one transaction with
 * `withinCreate`, and audits, records and notifies exactly as `createWorkflowFromSource` does.
 */
export const workflowSourceCreate = {
  plan: defineAuthorizedWorkflowUseCase({
    operation: workflowOperations.createFromSource,
    resolveContext: ({ input }: { input: CreatePlanInput }) =>
      resolveActiveWorkspaceApplicationContext(input.workspaceId),
    async execute({ principal, input, context }): Promise<PlannedSource | RefusedSource> {
      return planSource(
        principal,
        await createTarget(context, input.workflowId),
        { files: input.files, lock: EMPTY_LOCK, pendingResources: input.pendingResources },
        { loads: input.loads, allocate: false }
      )
    },
  }),
  commit: defineAuthorizedWorkflowUseCase({
    operation: workflowOperations.createFromSource,
    resolveContext: ({ input }: { input: CreateCommitInput }) =>
      resolveActiveWorkspaceApplicationContext(input.planned.loaded.scope.workspaceId),
    async execute({ principal, input, context }): Promise<SourceOutcome> {
      const facts = sourceAnalyticsFacts(
        principal,
        input.provenance,
        'create',
        context.workspaceId,
        false
      )
      try {
        const target = await createTarget(context, input.planned.workflowId)
        const planned = await planForCommit(principal, input.planned, target)
        return await commitSource(principal, planned, target, {
          withinCreate: input.withinCreate,
        })
      } catch (error) {
        recordSourceRefused({ ...facts, workflowId: '' }, error)
        throw error
      }
    },
    projectAudit: ({ principal, input, result }) =>
      sourceCreateAudit(principal, input.provenance, result),
    afterSuccess: ({ principal, input, result }) =>
      afterSourceCreate(principal, input.provenance, result),
  }),
}
