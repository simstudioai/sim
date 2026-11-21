import type { Principal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import type { SourceBase, WorkflowLockV1 } from '@sim/workflow-code'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveWorkflowFolderPath } from '@/lib/workflows/application/folders'
import {
  requireMutableFolder,
  requireMutableWorkflow,
} from '@/lib/workflows/application/mutability'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import {
  recordSourceDryRun,
  recordSourceRefused,
} from '@/lib/workflows/application/source-analytics'
import {
  afterSourceApply,
  afterSourceCreate,
  commitSource,
  EMPTY_LOCK,
  planSource,
  previewSource,
  refusalError,
  refusedOutcome,
  type SourceOutcome,
  type SourceProvenance,
  type SourceTarget,
  sourceAnalyticsFacts,
  sourceApplyAudit,
  sourceCreateAudit,
} from '@/lib/workflows/application/source-pipeline'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export interface ApplyWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  /** Repo-relative path → text: `workflow.ts` plus any function-code files it references. */
  files: Record<string, string>
  /** The identity lock returned by `source get` (or a previous apply). */
  lock: WorkflowLockV1
  /**
   * Where and when the source was read. The apply answers 409 when `base.fingerprint` no longer
   * matches the draft; a lock read in another workspace is treated as stale.
   */
  base: SourceBase
  /** Allow removing blocks the source no longer declares (`--allow-delete`); refused otherwise. */
  allowDelete?: boolean
  /** Run the whole pipeline and stop before the write. Never audits or notifies. */
  dryRun?: boolean
  provenance?: SourceProvenance
}

export interface CreateWorkflowFromSourceInput {
  workspaceId: string
  /** Repo-relative path → text: `workflow.ts` plus any function-code files it references. */
  files: Record<string, string>
  /** The new workflow's name; the source's `workflow('…')` name when omitted. */
  name?: string
  /** The new workflow's description; the source's when omitted. */
  description?: string | null
  /** Containing folder path; the workspace root when omitted. */
  folderPath?: string
  /** Run the whole pipeline and stop before the write. Never audits or notifies. */
  dryRun?: boolean
  provenance?: SourceProvenance
}

/**
 * Plans the submission onto `target`, then answers: a refused plan throws (409 when stale, else
 * 400), or on a dry run answers 200 with its findings; a planned one is previewed on a dry run
 * and committed otherwise.
 */
async function writeSource(
  principal: Principal,
  target: SourceTarget,
  submission: { files: Record<string, string>; lock: WorkflowLockV1 },
  dryRun: boolean
): Promise<SourceOutcome> {
  if (!dryRun) {
    const planned = await planSource(principal, target, submission, { allocate: true })
    if (planned.kind === 'refused') throw refusalError(planned)
    return commitSource(principal, planned, target)
  }
  const planned = await planSource(principal, target, submission, { allocate: false })
  return planned.kind === 'refused'
    ? refusedOutcome(planned, target, submission)
    : previewSource(principal, planned)
}

/**
 * Applies workflow source (TypeScript) to the stored draft. The server compiles the files
 * against its live per-workflow catalog and evaluates them onto the stored graph; any error
 * refuses the whole write, with source lines. The write is one replace under the workflow row
 * lock that re-checks the fingerprint (409 when the draft moved) and stores the submission's
 * idents, order and comments in source meta. A source that changes only those is a graph no-op
 * that stores just source meta. Draft only: it never deploys.
 */
export const applyWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applySource,
  resolveContext: resolvePrincipalWorkflowContext<ApplyWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<SourceOutcome> {
    const dryRun = input.dryRun === true
    const facts = sourceAnalyticsFacts(
      principal,
      input.provenance,
      'apply',
      context.workspaceId,
      dryRun
    )
    try {
      await requireMutableWorkflow(context.workflowId)
      const result = await writeSource(
        principal,
        { kind: 'existing', context, base: input.base, allowDelete: input.allowDelete === true },
        { files: input.files, lock: input.lock },
        dryRun
      )
      if (dryRun) recordSourceDryRun({ ...facts, workflowId: context.workflowId }, result)
      return result
    } catch (error) {
      recordSourceRefused({ ...facts, workflowId: context.workflowId }, error)
      throw error
    }
  },
  projectAudit: ({ principal, input, context, result }) =>
    sourceApplyAudit(principal, input.provenance, context.workflowId, result),
  afterSuccess: ({ principal, input, context, result }) =>
    afterSourceApply(principal, input.provenance, context, result),
})

/** What {@link planWorkflowSource} reads: a submission as an apply sends it, without its knobs. */
export interface PlanWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  files: Record<string, string>
  lock: WorkflowLockV1
  base: SourceBase
  /** Plan block and variable deletes as allowed, so the plan names them instead of refusing. */
  allowDelete?: boolean
}

/**
 * What an apply of this source would do, without writing: whether the draft moved since `base`
 * (`E_APPLY_STALE`), the diff and every finding, exactly as a dry run reports them. A read, so
 * `sim workflows source status` costs no write budget, needs only the `read` role, and records
 * no dry-run analytics; it audits and notifies nothing, like a dry run.
 */
export const planWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.planSource,
  resolveContext: resolvePrincipalWorkflowContext<PlanWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<SourceOutcome> {
    return writeSource(
      principal,
      { kind: 'existing', context, base: input.base, allowDelete: input.allowDelete === true },
      { files: input.files, lock: input.lock },
      true
    )
  },
})

/**
 * Creates a workflow from source: the same pipeline as {@link applyWorkflowSource} with an empty
 * graph as the stored draft, so every block is new, every id is minted and no fingerprint is
 * checked. The row, its graph, variables and source meta are written in one transaction, so a
 * refused or failed create leaves nothing behind. A dry run runs every check and creates nothing.
 */
export const createWorkflowFromSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.createFromSource,
  resolveContext: ({ input }: { input: CreateWorkflowFromSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<SourceOutcome> {
    const { folderId } = await resolveWorkflowFolderPath(
      context.workspaceId,
      input.folderPath ?? '/'
    )
    const dryRun = input.dryRun === true
    const facts = sourceAnalyticsFacts(
      principal,
      input.provenance,
      'create',
      context.workspaceId,
      dryRun
    )
    try {
      await requireMutableFolder(folderId)
      const result = await writeSource(
        principal,
        {
          kind: 'new',
          workspace: context,
          workflowId: generateId(),
          create: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
          folderId,
        },
        { files: input.files, lock: EMPTY_LOCK },
        dryRun
      )
      if (dryRun) recordSourceDryRun({ ...facts, workflowId: '' }, result)
      return result
    } catch (error) {
      recordSourceRefused({ ...facts, workflowId: '' }, error)
      throw error
    }
  },
  projectAudit: ({ principal, input, result }) =>
    sourceCreateAudit(principal, input.provenance, result),
  afterSuccess: ({ principal, input, result }) =>
    afterSourceCreate(principal, input.provenance, result),
})
