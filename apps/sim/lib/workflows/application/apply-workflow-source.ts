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
  BlockCatalog,
  CanonicalizeResult,
  SourceBase,
  SourceFingerprint,
  WorkflowLockV1,
  WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import { readWorkflowSourceMeta } from '@sim/workflow-persistence/source-meta'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import {
  type CatalogGate,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/context'
import { principalAuditSource } from '@/lib/core/application'
import type { DbTransaction } from '@/lib/db/types'
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
  recordSourceDryRun,
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
  WORKFLOW_SOURCE_STALE_MESSAGE,
  type WorkflowSourceDiagnostic,
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import {
  evaluateSource,
  type PendingResource,
  type SourcePlan,
  type SourceReference,
} from '@/lib/workflows/application/source-evaluate'
import { buildSourceCatalog, storedCatalogTypes } from '@/lib/workflows/code/catalog/workspace'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import {
  type PrintedSource,
  printStoredSource,
  type StoredSource,
  storedSourceFingerprint,
} from '@/lib/workflows/code/print-stored'
import { loadEnvNames } from '@/lib/workflows/code/resources'
import {
  canonicalizeStored,
  prefetchStoredResources,
  type StoredCanonical,
} from '@/lib/workflows/code/stored-canonical'
import {
  checkDraftNeedsRedeployment,
  checkNeedsRedeployment,
} from '@/lib/workflows/deployment-status'
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
  /** Resources the enclosing workspace source apply creates or adopts first (`evaluateSource`). */
  pendingResources?: readonly PendingResource[]
  /**
   * Evaluate and stop, for a caller that commits later through `evaluated`: a dry run without the
   * deployment check or the re-print of what a write would store, so the result's `files` echo
   * the submission and `needsRedeployment` is false. A create still checks its name is free. It
   * records no analytics: the caller's own commit (or its dry run) is the outcome.
   */
  planOnly?: boolean
  /**
   * A `planOnly` run's evaluation of this same submission: the write commits it without loading or
   * evaluating again. The commit still re-checks the fingerprint under the workflow row lock, so a
   * draft that moved since is a 409 as ever. In-process only, never on a wire contract.
   */
  evaluated?: EvaluatedSource
  /** Loads shared by every workflow one request evaluates (see {@link SourceRequestShare}). */
  shared?: SourceRequestShare
}

/**
 * Loads that are the same for every workflow one request evaluates in one workspace for one
 * principal (a workspace source apply): each starts on first use and is reused after. Never share
 * one across principals or workspaces.
 */
export interface SourceRequestShare {
  catalogGate?: Promise<CatalogGate>
  envNames?: Promise<string[]>
}

/**
 * What a `planOnly` run evaluated, handed back as `evaluated` so the write commits it as is: the
 * stored draft and catalog it was evaluated against, the fingerprint the commit re-checks, and
 * the plan.
 */
export interface EvaluatedSource {
  workflowId: string
  gate: CatalogGate
  catalog: BlockCatalog
  stored: StoredSource
  storedSourceMeta: WorkflowSourceMetaV1 | null
  storedCanonical: StoredCanonical
  /** The stored draft's fingerprint when evaluated; the write refuses a base that differs. */
  storedFingerprint: SourceFingerprint
  plan: SourcePlan
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
  /** Allow removing blocks the source no longer declares (`--allow-delete`); refused otherwise. */
  allowDelete?: boolean
}

export interface CreateWorkflowFromSourceInput extends SourceSubmission {
  workspaceId: string
  /**
   * The id the new workflow takes, minted by an enclosing workspace source apply so its other
   * workflows name this one before it is written; a fresh id when omitted. In-process only, never
   * on a wire contract.
   */
  workflowId?: string
  /** The new workflow's name; the source's `workflow('…')` name when omitted. */
  name?: string
  /** The new workflow's description; the source's when omitted. */
  description?: string | null
  /** Containing folder path; the workspace root when omitted. */
  folderPath?: string
  /**
   * Runs inside the create's transaction once the workflow and its graph are written, so what it
   * writes (a workspace source apply binding the folder's key) commits or rolls back with the
   * workflow. In-process only, never on a wire contract.
   */
  withinCreate?: (tx: DbTransaction, workflowId: string) => Promise<void>
}

interface ApplyWorkflowSourceResult {
  workflowId: string
  workflowName: string
  workspaceId: string
  dryRun: boolean
  /** True when the apply wrote a graph, or renamed or redescribed the workflow. */
  applied: boolean
  /** True when source meta was stored: with a graph write, or alone for a graph no-op. */
  wroteSourceMeta: boolean
  /**
   * True when a graph no-op still changes source meta (idents, order or comments): stored by a
   * commit, and on a dry run what a commit would store.
   */
  sourceMetaChanged: boolean
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
  /**
   * Every resource the submitted source names by key, as the compiler read it; empty when the
   * source did not compile.
   */
  references: SourceReference[]
  /**
   * Every env name the submitted source reads, as the compiler read it; empty when the source did
   * not compile.
   */
  envReferences: string[]
  notes: string[]
  needsRedeployment: boolean
  sdkMajor: number
  /** On a `planOnly` run that passed every check, what the write commits through `evaluated`. */
  evaluated?: EvaluatedSource
}

/**
 * Where a source apply writes: the stored draft of an existing workflow, or a new workflow the
 * apply creates, with an empty graph standing in for the stored one.
 */
type SourceApplyTarget =
  | {
      kind: 'existing'
      context: ActiveWorkflowApplicationContext
      base: SourceBase
      allowDelete: boolean
    }
  | {
      kind: 'new'
      workspace: ActiveWorkspaceApplicationContext
      workflowId: string
      create: { name?: string; description?: string | null }
      folderId: string | null
      withinCreate?: CreateWorkflowFromSourceInput['withinCreate']
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
    await requireWorkflowCodeEnabled(principal, context)
    const facts = analyticsFacts(principal, input, 'apply', context.workspaceId)
    try {
      await requireMutableWorkflow(context.workflowId)
      const result = await runSourceApply(principal, input, {
        kind: 'existing',
        context,
        base: input.base,
        allowDelete: input.allowDelete === true,
      })
      if (facts.dryRun) recordSourceDryRun({ ...facts, workflowId: context.workflowId }, result)
      return result
    } catch (error) {
      if (!input.planOnly) recordSourceRefused({ ...facts, workflowId: context.workflowId }, error)
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
  afterSuccess: async ({ principal, input, context, result }) => {
    if (result.applied) {
      recordSourceWritten(analyticsFacts(principal, input, 'apply', context.workspaceId), result)
    }
    if (!result.applied && !result.wroteSourceMeta) return
    await Promise.all([
      notifyWorkflowUpdated(context.workflowId),
      // A rename or new description changes how the workspace lists the workflow.
      result.applied && result.diff.meta?.length
        ? notifyWorkspaceWorkflowsChanged(context.workspaceId)
        : undefined,
    ])
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
    await requireWorkflowCodeEnabled(principal, context)
    const { folderId } = await resolveWorkflowFolderPath(
      context.workspaceId,
      input.folderPath ?? '/'
    )
    const facts = analyticsFacts(principal, input, 'create', context.workspaceId)
    try {
      await requireMutableFolder(folderId)
      const result = await runSourceApply(
        principal,
        { ...input, lock: { version: 1, blocks: {}, variables: {} } },
        {
          kind: 'new',
          workspace: context,
          workflowId: input.evaluated?.workflowId ?? input.workflowId ?? generateId(),
          create: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
          folderId,
          ...(input.withinCreate ? { withinCreate: input.withinCreate } : {}),
        }
      )
      if (facts.dryRun) recordSourceDryRun({ ...facts, workflowId: '' }, result)
      return result
    } catch (error) {
      if (!input.planOnly) recordSourceRefused({ ...facts, workflowId: '' }, error)
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
  return {
    principal,
    client: input.provenance?.client,
    operation,
    workspaceId,
    dryRun: input.dryRun === true,
  }
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
 * (empty for a new workflow), or take a `planOnly` run's evaluation, then write it: source meta
 * alone for a graph no-op, a replace under the row lock for an existing draft, or a create that
 * inserts the row and its graph in one transaction. A dry run stops before the write; a refusal
 * throws, or on a dry run answers 200.
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
  const planOnly = input.planOnly === true
  const dryRun = input.dryRun === true || planOnly
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
    folderId: target.kind === 'existing' ? target.context.workflow.folderId : target.folderId,
  }
  if (input.evaluated && input.evaluated.workflowId !== context.workflowId) {
    throw new Error('An evaluated source commits only to the workflow it was evaluated for')
  }

  const shared: SourceRequestShare = input.shared ?? {}
  const loaded = input.evaluated
    ? null
    : await Promise.all([
        (shared.catalogGate ??= resolveCatalogGate(principal, context, {
          customBlockInputs: true,
        })),
        target.kind === 'existing' ? loadStoredSource(target.context) : EMPTY_STORED_SOURCE,
        target.kind === 'existing' ? readWorkflowSourceMeta(db, context.workflowId) : null,
        prefetchStoredResources({
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
          createdBy,
        }),
        (shared.envNames ??= loadEnvNames(context.workspaceId, subjectUserId)),
      ])
  /**
   * Whether the draft differs from its deployment, for a dry run that leaves it as it is (a no-op
   * or a refusal): it writes nothing, so this is known now and runs beside the evaluation. A dry
   * run that would change the draft compares what it would write instead. The `catch` only keeps
   * it observed when an error throws first or it goes unused.
   */
  const dryRunNeedsRedeployment =
    dryRun && !planOnly && !isNew ? checkNeedsRedeployment(context.workflowId) : null
  dryRunNeedsRedeployment?.catch(() => {})
  const gate = input.evaluated?.gate ?? loaded?.[0]
  if (!gate) throw new Error('A source apply needs its catalog gate')
  return withCatalogBlockScope(gate, async () => {
    /** The one response shape: what is (or would be) stored, printed, and the outcome. */
    const result = async (
      evaluated: Pick<EvaluatedSource, 'catalog' | 'stored'>,
      printed: Pick<PrintedSource, 'files' | 'lock'> & Pick<SourceBase, 'fingerprint'>,
      outcome: Pick<ApplyWorkflowSourceResult, 'applied' | 'diff' | 'diagnostics'> &
        Partial<
          Pick<
            ApplyWorkflowSourceResult,
            | 'workflowName'
            | 'mintedIds'
            | 'references'
            | 'envReferences'
            | 'notes'
            | 'wroteSourceMeta'
            | 'sourceMetaChanged'
            | 'evaluated'
            | 'needsRedeployment'
          >
        >
    ): Promise<ApplyWorkflowSourceResult> => ({
      workflowId: context.workflowId,
      workflowName: evaluated.stored.meta.name,
      workspaceId: context.workspaceId,
      dryRun,
      mintedIds: {},
      references: [],
      envReferences: [],
      notes: [],
      wroteSourceMeta: false,
      sourceMetaChanged: false,
      ...outcome,
      files: printed.files,
      lock: printed.lock,
      base: {
        version: 1,
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        fingerprint: printed.fingerprint,
        catalogHash: evaluated.catalog.hash,
      },
      needsRedeployment:
        outcome.needsRedeployment ??
        (!isNew &&
          !planOnly &&
          (await (dryRunNeedsRedeployment ?? checkNeedsRedeployment(context.workflowId)))),
      sdkMajor: evaluated.catalog.sdkMajor,
    })

    let evaluated = input.evaluated
    if (!evaluated) {
      if (!loaded) throw new Error('A source apply needs its stored draft')
      const [, stored, storedSourceMeta, prefetched, envNames] = loaded
      const catalog = buildSourceCatalog({
        gate,
        organizationId: context.workspaceOrganizationId,
        storedTypes: storedCatalogTypes(Object.values(stored.state.blocks)),
      })
      const storedCanonical = await canonicalizeStored({
        prefetched,
        state: stored.state,
        meta: stored.meta,
        catalog,
      })
      const storedFingerprint = storedSourceFingerprint(
        storedCanonical.canonical,
        storedCanonical.resources
      )
      /**
       * Refuses a commit; a dry run reports the same findings with a 200 instead. The dry run
       * echoes the caller's own base fingerprint, so applying its response after a stale or
       * mismatched read still fails the freshness check rather than overwriting the newer draft.
       */
      const refuse = (
        diagnostics: WorkflowSourceDiagnostic[],
        compiledReferences?: Pick<ApplyWorkflowSourceResult, 'references' | 'envReferences'>
      ) => {
        if (!dryRun) throw new WorkflowSourceRejectedError(diagnostics)
        const fingerprint = target.kind === 'existing' ? target.base.fingerprint : storedFingerprint
        return result(
          { catalog, stored },
          { files: input.files, lock: input.lock, fingerprint },
          { applied: false, diff: emptyDiffSummary(), diagnostics, ...compiledReferences }
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
      if (target.kind === 'existing' && storedFingerprint !== target.base.fingerprint) {
        if (!dryRun) throw new WorkflowSourceStaleError(storedFingerprint)
        return refuse([
          {
            code: 'E_APPLY_STALE',
            severity: 'error',
            message: WORKFLOW_SOURCE_STALE_MESSAGE,
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
        ...(input.pendingResources ? { pendingResources: input.pendingResources } : {}),
        ...(target.kind === 'existing'
          ? { base: target.base, allowDelete: target.allowDelete }
          : {}),
        ...(target.kind === 'new' ? { create: target.create } : {}),
      })
      if ('refused' in evaluation) {
        return refuse(evaluation.refused, evaluation.compiledReferences)
      }
      evaluated = {
        workflowId: context.workflowId,
        gate,
        catalog,
        stored,
        storedSourceMeta,
        storedCanonical,
        storedFingerprint,
        plan: evaluation.plan,
      }
    }
    const { catalog, stored, storedSourceMeta, storedCanonical, storedFingerprint, plan } =
      evaluated
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
      // The stored graph under the name and description the write leaves it with.
      const lockless =
        plan.metaChanged.length > 0
          ? {
              ...storedCanonical.canonical,
              workflow: { ...storedCanonical.canonical.workflow, meta: plan.meta },
            }
          : storedCanonical.canonical
      const printed = print(stored.state, plan.sourceMeta, lockless)
      /** Unchanged source meta prints the same text, so only changed meta prints the "before". */
      const before = isEqual(plan.sourceMeta, storedSourceMeta)
        ? printed
        : print(stored.state, storedSourceMeta, lockless)
      const sourceMetaChanged =
        !isEqual(printed.files, before.files) || !isEqual(printed.lock, before.lock)
      const wroteSourceMeta = sourceMetaChanged && !dryRun
      const renamed = !dryRun && plan.metaChanged.length > 0
      if ((wroteSourceMeta || renamed) && target.kind === 'existing') {
        await commitSourceMeta({
          scope,
          plan,
          stored,
          storedFingerprint,
          catalog,
        })
      }
      return result(evaluated, printed, {
        applied: renamed,
        workflowName: plan.meta.name,
        diff,
        diagnostics,
        references: plan.references,
        envReferences: plan.envReferences,
        wroteSourceMeta,
        sourceMetaChanged,
        ...(planOnly ? { evaluated } : {}),
      })
    }

    if (planOnly) {
      // A create's name is checked now, so a taken one refuses the plan, not the write. An
      // update's ids are its own or minted (evaluation drops lock ids held elsewhere), and the
      // commit re-checks them under the row lock.
      if (target.kind === 'new') {
        await previewSourceCommit(context.workflowId, plan, {
          workspaceId: context.workspaceId,
          folderId: target.folderId,
        })
      }
      return result(
        evaluated,
        { files: input.files, lock: input.lock, fingerprint: storedFingerprint },
        {
          applied: false,
          diff,
          diagnostics,
          mintedIds,
          references: plan.references,
          envReferences: plan.envReferences,
          workflowName: plan.meta.name,
          evaluated,
        }
      )
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
      return result(evaluated, printWritten(preview.state), {
        applied: false,
        needsRedeployment:
          !isNew &&
          (await checkDraftNeedsRedeployment(context.workflowId, {
            ...preview.state,
            variables: plan.storedVariables,
          })),
        diff,
        diagnostics,
        mintedIds,
        references: plan.references,
        envReferences: plan.envReferences,
        notes: preview.warnings,
        workflowName: plan.meta.name,
      })
    }

    const committed =
      target.kind === 'new'
        ? await commitSourceCreate({
            scope,
            plan,
            folderId: target.folderId,
            ...(target.withinCreate ? { withinCreate: target.withinCreate } : {}),
          })
        : {
            ...(await commitSourceReplace({
              scope,
              plan,
              stored,
              storedFingerprint,
              catalog,
            })),
            name: plan.meta.name,
          }
    logger.info(isNew ? 'Created workflow from source' : 'Applied workflow source', logContext)
    return result(evaluated, printWritten(committed.state), {
      applied: true,
      wroteSourceMeta: true,
      diff,
      diagnostics,
      mintedIds,
      references: plan.references,
      envReferences: plan.envReferences,
      workflowName: committed.name,
      notes: committed.warnings,
    })
  })
}
