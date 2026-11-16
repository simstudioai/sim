import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import {
  type CanonicalizeResult,
  type LockBase,
  sourceFingerprint,
  type WorkflowCodeMetaV1,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { readWorkflowCodeMeta, writeWorkflowCodeMeta } from '@sim/workflow-persistence/code-meta'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated, notifyWorkspaceWorkflowsChanged } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveWorkflowFolderPath } from '@/lib/workflows/application/folders'
import { requireMutableWorkflow } from '@/lib/workflows/application/mutability'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import {
  type WorkflowSourceDiagnostic,
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import {
  commitSourceCreate,
  commitSourceReplace,
  previewSourceCommit,
} from '@/lib/workflows/code/apply/commit'
import { evaluateSource } from '@/lib/workflows/code/apply/evaluate'
import { emptyDiffSummary, type SourceDiffSummary } from '@/lib/workflows/code/apply/locate'
import {
  type PrintedSource,
  printStoredSource,
  type StoredSource,
} from '@/lib/workflows/code/apply/print'
import { buildCodeCatalog } from '@/lib/workflows/code/catalog/workspace-catalog'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { canonicalizeStored } from '@/lib/workflows/code/stored-canonical'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'

const logger = createLogger('ApplyWorkflowSource')

/** What every source submission carries, whether it updates a draft or creates a workflow. */
interface SourceSubmission {
  /** Repo-relative path → text: `workflow.ts` plus any function-code files it references. */
  files: Record<string, string>
  /** Run the whole pipeline and stop before the write. Never audits or notifies. */
  dryRun?: boolean
  provenance?: { client: 'cli' | 'copilot' | 'canvas' | 'api'; gitSha?: string; repo?: string }
}

export interface ApplyWorkflowSourceInput extends SourceSubmission {
  workflowId: string
  assertedWorkspaceId?: string
  /** The identity lock returned by `source get` (or a previous apply). */
  lock: WorkflowLockV1
  /** The environment facts that came with the lock; a lock read elsewhere is treated as stale. */
  lockBase?: LockBase
  /** The `fingerprint` the source was read at; the apply answers 409 when it no longer matches. */
  baseFingerprint: string
}

export interface CreateWorkflowFromSourceInput extends SourceSubmission {
  workspaceId: string
  /** The new workflow's name; the source's `workflow('…')` name when omitted. */
  name?: string
  /** The new workflow's description; the source's when omitted. */
  description?: string | null
  /** Containing folder path; the workspace root when omitted. */
  folderPath?: string
}

interface ApplyWorkflowSourceResult {
  workflowId: string
  workflowName: string
  workspaceId: string
  dryRun: boolean
  /** True only when a graph was written. */
  applied: boolean
  diff: SourceDiffSummary
  /** Warnings on success; on a dry run, every finding including the errors a commit would refuse. */
  diagnostics: WorkflowSourceDiagnostic[]
  /** The fingerprint of what is (or would be) stored; the next apply's `baseFingerprint`. */
  newFingerprint: string
  /** Re-printed from what is (or would be) stored, so normalized values show in the source. */
  files: Record<string, string>
  lock: WorkflowLockV1
  lockBase: LockBase
  /** Source key → id for every new block whose id was minted rather than taken from the lock. */
  mintedIds: Record<string, string>
  warnings: string[]
  needsRedeployment: boolean
  sdkMajor: number
  catalogVersion: string
}

/**
 * Where a source apply writes: the stored draft of an existing workflow, or a new workflow the
 * apply creates, with an empty graph standing in for the stored one.
 */
type SourceApplyTarget =
  | { kind: 'existing'; context: ActiveWorkflowApplicationContext; baseFingerprint: string }
  | {
      kind: 'new'
      workspace: ActiveWorkspaceApplicationContext
      workflowId: string
      create: { name?: string; description?: string | null }
      folderId: string | null
    }

/**
 * Applies workflow source (TypeScript) to the stored draft. The server compiles the files
 * against its live per-workflow catalog and evaluates them onto the stored graph
 * (`evaluateSource`); any error refuses the whole write, with source lines. The write is one
 * replace under the workflow row lock that re-checks the fingerprint (409 when the draft moved)
 * and stores the submission's bindings, order and comments in `code_meta`. A source that changes
 * only those is a graph no-op that stores just `code_meta`. Draft only: it never deploys.
 */
export const applyWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applySource,
  resolveContext: resolvePrincipalWorkflowContext<ApplyWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<ApplyWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    await requireMutableWorkflow(context.workflowId)
    return runSourceApply(principal, input, {
      kind: 'existing',
      context,
      baseFingerprint: input.baseFingerprint,
    })
  },
  /** Only a committed, non-empty apply is a change worth auditing. */
  projectAudit: ({ principal, input, context, result }) =>
    result.applied
      ? ({
          action: AuditAction.WORKFLOW_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: result.workflowName,
          description: `Applied workflow source to workflow "${result.workflowName}"`,
          metadata: sourceAuditMetadata(principal, input, result),
        } as const)
      : [],
  afterSuccess: ({ context, result }) => {
    if (!result.applied) return
    return notifyWorkflowUpdated(context.workflowId)
  },
})

/**
 * Creates a workflow from source: the same pipeline as {@link applyWorkflowSource} with an empty
 * graph as the stored draft, so every block is new, every id is minted and no fingerprint is
 * checked. The row, its graph, variables and `code_meta` are written in one transaction, so a
 * refused or failed create leaves nothing behind. A dry run runs every check and creates nothing.
 */
export const createWorkflowFromSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.createFromSource,
  resolveContext: ({ input }: { input: CreateWorkflowFromSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<ApplyWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    const { folderId } = await resolveWorkflowFolderPath(
      context.workspaceId,
      input.folderPath ?? '/'
    )
    try {
      await assertFolderMutable(folderId)
    } catch (error) {
      if (error instanceof FolderLockedError) throw new OrchestrationError('locked', error.message)
      throw error
    }
    return runSourceApply(
      principal,
      { ...input, lock: { lockVersion: 1, blocks: {}, variables: {} } },
      {
        kind: 'new',
        workspace: context,
        workflowId: generateId(),
        create: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        folderId,
      }
    )
  },
  projectAudit: ({ principal, input, result }) =>
    result.applied
      ? ({
          action: AuditAction.WORKFLOW_CREATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: result.workflowId,
          resourceName: result.workflowName,
          description: `Created workflow "${result.workflowName}" from source`,
          metadata: sourceAuditMetadata(principal, input, result),
        } as const)
      : [],
  afterSuccess: async ({ result }) => {
    if (!result.applied) return
    await Promise.all([
      notifyWorkflowUpdated(result.workflowId),
      notifyWorkspaceWorkflowsChanged(result.workspaceId),
    ])
  },
})

/** The audit metadata a committed source write records, for update and create alike. */
function sourceAuditMetadata(
  principal: Principal,
  input: SourceSubmission,
  result: ApplyWorkflowSourceResult
) {
  const { blocks, edges, variables } = result.diff
  return {
    op: 'apply_source',
    blocksAdded: blocks.added.length,
    blocksRemoved: blocks.removed.length,
    blocksRenamed: blocks.renamed.length,
    blocksModified: blocks.modified.length,
    edgesAdded: edges.added,
    edgesRemoved: edges.removed,
    variablesChanged: variables.added.length + variables.removed.length + variables.modified.length,
    sdkMajor: result.sdkMajor,
    catalogVersion: result.catalogVersion,
    ...(input.provenance ? { client: input.provenance.client } : {}),
    ...(input.provenance?.gitSha ? { gitSha: input.provenance.gitSha } : {}),
    source: principalAuditSource(principal),
  }
}

/** The stored draft through the loader `source get` reads, so the two fingerprint alike. */
async function loadStoredSource(context: ActiveWorkflowApplicationContext): Promise<StoredSource> {
  const { blocks, edges, loops, parallels, variables } = await loadWorkflowGraph(context)
  return {
    state: { blocks, edges, loops, parallels, variables },
    meta: { name: context.workflow.name, description: context.workflow.description ?? null },
  }
}

/**
 * The source-apply pipeline for either target: evaluate the submission onto the stored graph
 * (empty for a new workflow), then write it: `code_meta` alone for a graph no-op, a replace under
 * the row lock for an existing draft, or a create that inserts the row and its graph in one
 * transaction. A dry run stops before the write; a refusal throws, or on a dry run answers 200.
 */
async function runSourceApply(
  principal: Principal,
  input: SourceSubmission & { lock: WorkflowLockV1; lockBase?: LockBase },
  target: SourceApplyTarget
): Promise<ApplyWorkflowSourceResult> {
  const context =
    target.kind === 'existing'
      ? target.context
      : { ...target.workspace, workflowId: target.workflowId }
  const isNew = target.kind === 'new'
  const dryRun = input.dryRun === true

  const gate = await resolveCatalogGate(principal, context, { customBlockInputs: true })
  return withCatalogBlockScope(gate, async () => {
    const subjectUserId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const [stored, storedCodeMeta]: [StoredSource, WorkflowCodeMetaV1 | null] =
      target.kind === 'existing'
        ? await Promise.all([
            loadStoredSource(target.context),
            readWorkflowCodeMeta(db, context.workflowId),
          ])
        : [
            {
              state: { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} },
              meta: { name: '', description: null },
            },
            null,
          ]
    const { catalog } = buildCodeCatalog({
      gate,
      organizationId: context.workspaceOrganizationId,
      storedTypes: [...new Set(Object.values(stored.state.blocks).map((block) => block.type))],
    })
    const createdBy = resolvePrincipalSubjectUserId(principal) ?? null
    const storedCanonical = await canonicalizeStored({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      state: stored.state,
      meta: stored.meta,
      catalog,
      createdBy,
    })
    const storedFingerprint = sourceFingerprint(
      storedCanonical.canonical.workflow,
      storedCanonical.canonical.identity
    )

    /** The one response shape: what is (or would be) stored, printed, and the outcome. */
    const result = async (
      printed: Pick<PrintedSource, 'files' | 'lock' | 'fingerprint'>,
      outcome: Pick<ApplyWorkflowSourceResult, 'applied' | 'diff' | 'diagnostics'> &
        Partial<Pick<ApplyWorkflowSourceResult, 'workflowName' | 'mintedIds' | 'warnings'>>
    ): Promise<ApplyWorkflowSourceResult> => ({
      workflowId: context.workflowId,
      workflowName: stored.meta.name,
      workspaceId: context.workspaceId,
      dryRun,
      mintedIds: {},
      warnings: [],
      ...outcome,
      newFingerprint: printed.fingerprint,
      files: printed.files,
      lock: printed.lock,
      lockBase: {
        workspaceId: context.workspaceId,
        baseFingerprint: printed.fingerprint,
        catalogHash: catalog.hash,
      },
      needsRedeployment: !isNew && (await checkNeedsRedeployment(context.workflowId)),
      sdkMajor: catalog.sdkMajor,
      catalogVersion: catalog.hash,
    })
    /** Refuses a commit; a dry run reports the same findings with a 200 instead. */
    const refuse = (diagnostics: WorkflowSourceDiagnostic[]) => {
      if (!dryRun) throw new WorkflowSourceRejectedError(diagnostics)
      return result(
        { files: input.files, lock: input.lock, fingerprint: storedFingerprint },
        { applied: false, diff: emptyDiffSummary(), diagnostics }
      )
    }

    if (target.kind === 'existing' && storedFingerprint !== target.baseFingerprint) {
      if (!dryRun) throw new WorkflowSourceStaleError(storedFingerprint)
      return refuse([
        {
          code: 'E_APPLY_STALE',
          severity: 'error',
          message:
            'The workflow changed since this source was read. Get the source again, reapply your edit and retry.',
        },
      ])
    }

    const evaluation = await evaluateSource({
      principal,
      scope: {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        workspaceOrganizationId: context.workspaceOrganizationId,
        subjectUserId,
      },
      stored,
      storedCanonical,
      storedFingerprint,
      storedCodeMeta,
      catalog,
      createdBy,
      files: input.files,
      lock: input.lock,
      ...(input.lockBase ? { lockBase: input.lockBase } : {}),
      ...(target.kind === 'new' ? { create: target.create } : {}),
    })
    if ('refused' in evaluation) return refuse(evaluation.refused)
    const { plan } = evaluation
    const { diff, diagnostics, mintedIds } = plan
    /** Prints a state under the keys the submission bound, as the next `source get` will. */
    const print = (
      state: WorkflowState,
      codeMeta: WorkflowCodeMetaV1 | null,
      lockless?: CanonicalizeResult
    ) =>
      printStoredSource({
        state,
        meta: plan.meta,
        catalog,
        resources: plan.resources,
        codeMeta,
        functionCode: plan.functionCode,
        identity: plan.identity,
        ...(lockless ? { lockless } : {}),
      })
    const printWritten = (written: Omit<WorkflowState, 'variables'>) =>
      print({ ...written, variables: plan.storedVariables }, plan.codeMeta)
    const logContext = {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      principalKind: principal.kind,
    }

    if (plan.noop) {
      const printed = print(stored.state, plan.codeMeta, storedCanonical.canonical)
      if (!dryRun) {
        const before = print(stored.state, storedCodeMeta, storedCanonical.canonical)
        if (!isEqual(printed.files, before.files) || !isEqual(printed.lock, before.lock)) {
          await writeWorkflowCodeMeta(db, context.workflowId, plan.codeMeta)
        }
      }
      return result(printed, { applied: false, diff, diagnostics, warnings: plan.warnings })
    }

    const scope = {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      subjectUserId,
    }
    if (dryRun) {
      const preview = await previewSourceCommit(context.workflowId, plan)
      logger.info('Evaluated workflow source without persisting', logContext)
      return result(printWritten(preview.state), {
        applied: false,
        diff,
        diagnostics,
        mintedIds,
        warnings: [...plan.warnings, ...preview.warnings],
      })
    }

    const committed =
      target.kind === 'new'
        ? await commitSourceCreate({ scope, plan, folderId: target.folderId })
        : await commitSourceReplace({
            scope,
            plan,
            stored,
            storedFingerprint,
            baseFingerprint: target.baseFingerprint,
            catalog,
          })
    logger.info(isNew ? 'Created workflow from source' : 'Applied workflow source', logContext)
    return result(printWritten(committed.state), {
      applied: true,
      diff,
      diagnostics,
      mintedIds,
      ...('name' in committed ? { workflowName: committed.name } : {}),
      warnings: [...plan.warnings, ...committed.warnings],
    })
  })
}
