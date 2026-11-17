import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type {
  CanonicalizeResult,
  SourceBase,
  WorkflowLockV1,
  WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import { readWorkflowSourceMeta } from '@sim/workflow-persistence/source-meta'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { principalAuditSource } from '@/lib/core/application'
import { notifyWorkflowUpdated, notifyWorkspaceWorkflowsChanged } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveWorkflowFolderPath } from '@/lib/workflows/application/folders'
import {
  requireMutableFolder,
  requireMutableWorkflow,
} from '@/lib/workflows/application/mutability'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadStoredSource } from '@/lib/workflows/application/read-workflow-source'
import {
  recordSourceRefused,
  recordSourceWritten,
} from '@/lib/workflows/application/source-analytics'
import {
  commitSourceCreate,
  commitSourceMeta,
  commitSourceReplace,
  previewSourceCommit,
} from '@/lib/workflows/application/source-commit'
import { emptyDiffSummary, type SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import {
  type WorkflowSourceDiagnostic,
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import { evaluateSource } from '@/lib/workflows/application/source-evaluate'
import { buildSourceCatalog } from '@/lib/workflows/code/catalog/workspace'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import {
  type PrintedSource,
  printStoredSource,
  type StoredSource,
  storedFingerprint,
} from '@/lib/workflows/code/print-stored'
import { loadEnvNames } from '@/lib/workflows/code/resources'
import { canonicalizeStored, prefetchStoredResources } from '@/lib/workflows/code/stored-canonical'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'

const logger = createLogger('ApplyWorkflowSource')

/** The stored draft a create applies onto: an empty graph. */
const EMPTY_STORED_SOURCE: StoredSource = {
  state: { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} },
  meta: { name: '', description: null },
}

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
  /**
   * Where and when the source was read. The apply answers 409 when `base.fingerprint` no longer
   * matches the draft; a lock read in another workspace is treated as stale.
   */
  base: SourceBase
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
  /** True when source meta was stored: with a graph write, or alone for a graph no-op. */
  wroteSourceMeta: boolean
  diff: SourceDiffSummary
  /** Warnings on success; on a dry run, every finding including the errors a commit would refuse. */
  diagnostics: WorkflowSourceDiagnostic[]
  /** Re-printed from what is (or would be) stored, so normalized values show in the source. */
  files: Record<string, string>
  lock: WorkflowLockV1
  /** Where what is (or would be) stored was read: the next apply's `base`. */
  base: SourceBase
  /** Source key → id for every new block whose id was minted rather than taken from the lock. */
  mintedIds: Record<string, string>
  notes: string[]
  needsRedeployment: boolean
  sdkMajor: number
}

/**
 * Where a source apply writes: the stored draft of an existing workflow, or a new workflow the
 * apply creates, with an empty graph standing in for the stored one.
 */
type SourceApplyTarget =
  | { kind: 'existing'; context: ActiveWorkflowApplicationContext; base: SourceBase }
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
 * and stores the submission's idents, order and comments in source meta. A source that changes
 * only those is a graph no-op that stores just source meta. Draft only: it never deploys.
 */
export const applyWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applySource,
  resolveContext: resolvePrincipalWorkflowContext<ApplyWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<ApplyWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    const facts = analyticsFacts(principal, input, 'apply', context.workspaceId)
    try {
      await requireMutableWorkflow(context.workflowId)
      return await runSourceApply(principal, input, {
        kind: 'existing',
        context,
        base: input.base,
      })
    } catch (error) {
      if (!input.dryRun) recordSourceRefused({ ...facts, workflowId: context.workflowId }, error)
      throw error
    }
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
  /** Source meta alone changes what an open Code tab prints, so it notifies too. */
  afterSuccess: ({ principal, input, context, result }) => {
    if (result.applied) {
      recordSourceWritten(analyticsFacts(principal, input, 'apply', context.workspaceId), result)
    }
    if (!result.applied && !result.wroteSourceMeta) return
    return notifyWorkflowUpdated(context.workflowId)
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
  async execute({ principal, input, context }): Promise<ApplyWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    const { folderId } = await resolveWorkflowFolderPath(
      context.workspaceId,
      input.folderPath ?? '/'
    )
    const facts = analyticsFacts(principal, input, 'create', context.workspaceId)
    try {
      await requireMutableFolder(folderId)
      return await runSourceApply(
        principal,
        { ...input, lock: { version: 1, blocks: {}, variables: {} } },
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
    } catch (error) {
      if (!input.dryRun) recordSourceRefused({ ...facts, workflowId: '' }, error)
      throw error
    }
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
  afterSuccess: async ({ principal, input, result }) => {
    if (!result.applied) return
    recordSourceWritten(analyticsFacts(principal, input, 'create', result.workspaceId), result)
    await Promise.all([
      notifyWorkflowUpdated(result.workflowId),
      notifyWorkspaceWorkflowsChanged(result.workspaceId),
    ])
  },
})

function analyticsFacts(
  principal: Principal,
  input: SourceSubmission,
  operation: 'apply' | 'create',
  workspaceId: string
) {
  return { principal, client: input.provenance?.client, operation, workspaceId }
}

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
    catalogHash: result.base.catalogHash,
    ...(input.provenance ? { client: input.provenance.client } : {}),
    ...(input.provenance?.gitSha ? { gitSha: input.provenance.gitSha } : {}),
    source: principalAuditSource(principal),
  }
}

/**
 * The source-apply pipeline for either target: evaluate the submission onto the stored graph
 * (empty for a new workflow), then write it: source meta alone for a graph no-op, a replace under
 * the row lock for an existing draft, or a create that inserts the row and its graph in one
 * transaction. A dry run stops before the write; a refusal throws, or on a dry run answers 200.
 */
async function runSourceApply(
  principal: Principal,
  input: SourceSubmission & { lock: WorkflowLockV1 },
  target: SourceApplyTarget
): Promise<ApplyWorkflowSourceResult> {
  const context =
    target.kind === 'existing'
      ? target.context
      : { ...target.workspace, workflowId: target.workflowId }
  const isNew = target.kind === 'new'
  const dryRun = input.dryRun === true
  const subjectUserId = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: context.billedAccountUserId,
  }).attributedUserId
  const createdBy = resolvePrincipalSubjectUserId(principal) ?? null
  /** Who and where the write acts: what the evaluation gates and the commit re-checks run as. */
  const scope = {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    workspaceOrganizationId: context.workspaceOrganizationId,
    subjectUserId,
  }

  const [gate, stored, storedSourceMeta, prefetched, envNames] = await Promise.all([
    resolveCatalogGate(principal, context, { customBlockInputs: true }),
    target.kind === 'existing' ? loadStoredSource(target.context) : EMPTY_STORED_SOURCE,
    target.kind === 'existing' ? readWorkflowSourceMeta(db, context.workflowId) : null,
    prefetchStoredResources({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      createdBy,
    }),
    loadEnvNames(context.workspaceId, subjectUserId),
  ])
  /**
   * A dry run writes no graph, so whether the draft differs from its deployment is known now and
   * runs beside the evaluation. The `catch` only keeps it observed when an error throws first.
   */
  const dryRunNeedsRedeployment =
    dryRun && !isNew ? checkNeedsRedeployment(context.workflowId) : null
  dryRunNeedsRedeployment?.catch(() => {})
  return withCatalogBlockScope(gate, async () => {
    const catalog = buildSourceCatalog({
      gate,
      organizationId: context.workspaceOrganizationId,
      storedTypes: Object.values(stored.state.blocks).map((block) => block.type),
    })
    const storedCanonical = await canonicalizeStored({
      prefetched,
      state: stored.state,
      meta: stored.meta,
      catalog,
    })
    const baseFingerprint = storedFingerprint(storedCanonical.canonical)

    /** The one response shape: what is (or would be) stored, printed, and the outcome. */
    const result = async (
      printed: Pick<PrintedSource, 'files' | 'lock'> & Pick<SourceBase, 'fingerprint'>,
      outcome: Pick<ApplyWorkflowSourceResult, 'applied' | 'diff' | 'diagnostics'> &
        Partial<
          Pick<
            ApplyWorkflowSourceResult,
            'workflowName' | 'mintedIds' | 'notes' | 'wroteSourceMeta'
          >
        >
    ): Promise<ApplyWorkflowSourceResult> => ({
      workflowId: context.workflowId,
      workflowName: stored.meta.name,
      workspaceId: context.workspaceId,
      dryRun,
      mintedIds: {},
      notes: [],
      wroteSourceMeta: false,
      ...outcome,
      files: printed.files,
      lock: printed.lock,
      base: {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        fingerprint: printed.fingerprint,
        catalogHash: catalog.hash,
      },
      needsRedeployment:
        !isNew && (await (dryRunNeedsRedeployment ?? checkNeedsRedeployment(context.workflowId))),
      sdkMajor: catalog.sdkMajor,
    })
    /**
     * Refuses a commit; a dry run reports the same findings with a 200 instead. The dry run
     * echoes the caller's own base fingerprint, so applying its response after a stale or
     * mismatched read still fails the freshness check rather than overwriting the newer draft.
     */
    const refuse = (diagnostics: WorkflowSourceDiagnostic[]) => {
      if (!dryRun) throw new WorkflowSourceRejectedError(diagnostics)
      const fingerprint = target.kind === 'existing' ? target.base.fingerprint : baseFingerprint
      return result(
        { files: input.files, lock: input.lock, fingerprint },
        { applied: false, diff: emptyDiffSummary(), diagnostics }
      )
    }

    if (target.kind === 'existing' && target.base.workflowId !== context.workflowId) {
      return refuse([
        {
          code: 'E_APPLY_WORKFLOW_MISMATCH',
          severity: 'error',
          message: `This source was read from workflow ${target.base.workflowId}, not ${context.workflowId}; applying it here would overwrite a different workflow.`,
          hint: 'Apply it to the workflow it was read from, or get this workflow’s source into its own directory.',
          path: '/base/workflowId',
        },
      ])
    }
    if (target.kind === 'existing' && baseFingerprint !== target.base.fingerprint) {
      if (!dryRun) throw new WorkflowSourceStaleError(baseFingerprint)
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
      scope,
      stored,
      storedCanonical,
      storedSourceMeta,
      catalog,
      envNames: new Set(envNames),
      createdBy,
      files: input.files,
      lock: input.lock,
      ...(target.kind === 'existing' ? { base: target.base } : {}),
      ...(target.kind === 'new' ? { create: target.create } : {}),
    })
    if ('refused' in evaluation) return refuse(evaluation.refused)
    const { plan } = evaluation
    const { diff, diagnostics, mintedIds } = plan
    /** The function files the submission named, kept so a write never renames the author's. */
    const submittedCodeFiles: Record<string, string> = {}
    for (const [key, hint] of Object.entries(plan.compiled.hints.blocks)) {
      if (hint.codeFile !== undefined) submittedCodeFiles[key] = hint.codeFile
    }
    /** Prints a state under the keys the submission bound, as the next `source get` will. */
    const print = (
      state: WorkflowState,
      sourceMeta: WorkflowSourceMetaV1 | null,
      lockless?: CanonicalizeResult
    ) =>
      printStoredSource({
        state,
        meta: plan.meta,
        catalog,
        resources: plan.resources,
        sourceMeta,
        functionCode: plan.functionCode,
        identity: plan.identity,
        codeFiles: submittedCodeFiles,
        ...(lockless ? { lockless } : {}),
      })
    const printWritten = (written: Omit<WorkflowState, 'variables'>) =>
      print({ ...written, variables: plan.storedVariables }, plan.sourceMeta)
    const logContext = {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      principalKind: principal.kind,
    }

    if (plan.noop) {
      const printed = print(stored.state, plan.sourceMeta, storedCanonical.canonical)
      /** Unchanged source meta prints the same text, so only changed meta prints the "before". */
      const before =
        dryRun || isEqual(plan.sourceMeta, storedSourceMeta)
          ? printed
          : print(stored.state, storedSourceMeta, storedCanonical.canonical)
      const wroteSourceMeta =
        !isEqual(printed.files, before.files) || !isEqual(printed.lock, before.lock)
      if (wroteSourceMeta && target.kind === 'existing') {
        await commitSourceMeta({
          scope,
          plan,
          stored,
          storedFingerprint: baseFingerprint,
          catalog,
        })
      }
      return result(printed, {
        applied: false,
        diff,
        diagnostics,
        notes: plan.notes,
        wroteSourceMeta,
      })
    }

    if (dryRun) {
      const preview = await previewSourceCommit(
        context.workflowId,
        plan,
        target.kind === 'new'
          ? { workspaceId: context.workspaceId, folderId: target.folderId }
          : undefined
      )
      logger.info('Evaluated workflow source without persisting', logContext)
      return result(printWritten(preview.state), {
        applied: false,
        diff,
        diagnostics,
        mintedIds,
        notes: [...plan.notes, ...preview.warnings],
      })
    }

    const committed =
      target.kind === 'new'
        ? await commitSourceCreate({ scope, plan, folderId: target.folderId })
        : {
            ...(await commitSourceReplace({
              scope,
              plan,
              stored,
              storedFingerprint: baseFingerprint,
              catalog,
            })),
            name: stored.meta.name,
          }
    logger.info(isNew ? 'Created workflow from source' : 'Applied workflow source', logContext)
    return result(printWritten(committed.state), {
      applied: true,
      wroteSourceMeta: true,
      diff,
      diagnostics,
      mintedIds,
      workflowName: committed.name,
      notes: [...plan.notes, ...committed.warnings],
    })
  })
}
