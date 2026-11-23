import type { Principal } from '@sim/auth/principal'
import type {
  BlockCatalog,
  ResourceKind,
  SourceBase,
  SourceFingerprint,
  WorkflowLockV1,
} from '@sim/workflow-code'
import { diagnostic } from '@sim/workflow-code/diagnostics'
import { isEqual } from 'es-toolkit'
import { withCatalogBlockScope } from '@/lib/catalog/application/context'
import { assertCreateNameFree } from '@/lib/workflows/application/source-commit'
import { emptyDiffSummary, type SourceDiffSummary } from '@/lib/workflows/application/source-diff'
import {
  type WorkflowSourceDiagnostic,
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
  workflowSourceStaleMessage,
} from '@/lib/workflows/application/source-error'
import {
  type CompiledReferences,
  evaluateSource,
  type PendingResource,
  type SourcePlan,
  type SourceReference,
} from '@/lib/workflows/application/source-pipeline/evaluate'
import {
  type LoadedTarget,
  loadSourceTarget,
  type SourceLoads,
  type SourceTarget,
} from '@/lib/workflows/application/source-pipeline/load'
import { printPlanned } from '@/lib/workflows/application/source-pipeline/outcome'
import type { PrintedSource, StoredSource } from '@/lib/workflows/code/print-stored'

/** What a source submission carries to a plan. */
interface SourceSubmission {
  /** Repo-relative path → text: `workflow.ts` plus any function-code files it references. */
  files: Record<string, string>
  /** The identity lock returned by `source get` (or a previous apply); empty for a create. */
  lock: WorkflowLockV1
  /** Resources the enclosing workspace source apply creates or adopts first. */
  pendingResources?: readonly PendingResource[]
}

/**
 * The identity a plan is bound to: a commit refuses a plan made for another principal. The key is
 * the principal as it authenticated, so two sessions or keys of one user are two principals.
 */
function principalKey(principal: Principal): string {
  return JSON.stringify(principal)
}

/** Why a commit refuses a plan: made for another workflow or write, or by another principal. */
type PlanBindingCode = 'PLAN_WORKFLOW_MISMATCH' | 'PLAN_PRINCIPAL_MISMATCH'

/**
 * A commit was handed a plan it may not write: a bug in the caller, not something its user can
 * fix, so it stays unclassified (a 500). `code` says which binding the plan broke.
 */
export class PlanBindingError extends Error {
  constructor(
    readonly code: PlanBindingCode,
    message: string
  ) {
    super(message)
    this.name = 'PlanBindingError'
  }
}

/** Throws {@link PlanBindingError} unless `planned` was made by `principal`. */
export function assertPlannedBy(principal: Principal, planned: PlannedSource): void {
  if (planned.boundTo.principalKey !== principalKey(principal)) {
    throw new PlanBindingError(
      'PLAN_PRINCIPAL_MISMATCH',
      'A planned source commits only as the principal it was planned by'
    )
  }
}

/**
 * A plan that passed every check, bound to the workflow and principal it was made for. Outside the
 * pipeline, read only `kind` and `workflowId`, and the rest through {@link summarizePlan}; the
 * other fields are what the pipeline's commit and preview read.
 */
export interface PlannedSource {
  kind: 'planned'
  /** The workflow the plan writes: the stored one, or the id a create takes. */
  workflowId: string
  boundTo: { principalKey: string }
  /** The target the plan was evaluated against. */
  target: SourceTarget
  loaded: LoadedTarget
  plan: SourcePlan
  /**
   * For a graph no-op: the stored graph printed under the source meta the write leaves it with,
   * and whether that differs from what is stored (new idents, order or comments).
   */
  noop?: { printed: PrintedSource; sourceMetaChanged: boolean }
  /**
   * Set when the plan resolved a stand-in id of a resource the enclosing apply has yet to create:
   * such a plan cannot be committed as it is, so the commit plans `submission` again (with `loads`)
   * once that resource is written under its real id.
   */
  replan?: { submission: SourceSubmission; loads?: SourceLoads }
}

/** What a caller outside the pipeline reads of a plan, refused or not. */
export interface SourcePlanSummary {
  diagnostics: readonly WorkflowSourceDiagnostic[]
  /** Empty for a refusal, which plans no change. */
  diff: SourceDiffSummary
  /** What the source references, as the compiler read it; empty when it did not compile. */
  references: readonly SourceReference[]
  envReferences: readonly string[]
  /** Whether a graph no-op still changes source meta (idents, order or comments). */
  sourceMetaChanged: boolean
  /** The workflow's name after the write; absent for a refusal. */
  workflowName?: string
  /** Each block of the planned graph, by id; absent for a refusal. */
  blocks?: ReadonlyArray<{ id: string; name: string }>
  /** The id the plan resolved for a resource the source names by key, or null. */
  resolveId(kind: ResourceKind, key: string): string | null
}

/** The {@link SourcePlanSummary} of a plan or a refusal. */
export function summarizePlan(outcome: PlannedSource | RefusedSource): SourcePlanSummary {
  if (outcome.kind === 'refused') {
    return {
      diagnostics: outcome.diagnostics,
      diff: emptyDiffSummary(),
      references: outcome.compiledReferences?.references ?? [],
      envReferences: outcome.compiledReferences?.envReferences ?? [],
      sourceMetaChanged: false,
      resolveId: () => null,
    }
  }
  const { plan } = outcome
  return {
    diagnostics: plan.diagnostics,
    diff: plan.diff,
    references: plan.references,
    envReferences: plan.envReferences,
    sourceMetaChanged: outcome.noop?.sourceMetaChanged ?? false,
    workflowName: plan.meta.name,
    blocks: Object.values(plan.blocks).map(({ id, name }) => ({ id, name })),
    resolveId: (kind, key) => plan.resources.toId(kind, key),
  }
}

/**
 * Whether `references` name a resource of `pending` by a stand-in id. A workflow the enclosing
 * apply creates is no stand-in: its id is minted at plan time and is the one its create stores.
 */
function resolvesPlaceholder(
  references: readonly SourceReference[],
  pending: readonly PendingResource[]
): boolean {
  return references.some((ref) =>
    pending.some((entry) => entry.placeholder && entry.kind === ref.kind && entry.key === ref.key)
  )
}

/**
 * The plan a commit writes, once `planned` is shown to be the committing principal's (a foreign
 * plan throws {@link PlanBindingError} before any replan): `planned` itself, or (when it resolved a
 * stand-in id) the submission planned again onto `target` with every resource but the workflows
 * the apply creates read as stored, since the apply writes those first; a refusal of that plan
 * throws. Pending falls back only where stored resolution fails, so dropping the stand-ins is what
 * refuses a resource the apply never created instead of writing its stand-in id. The workflows
 * still resolve from pending, as a create of one may not have run yet.
 */
export async function planForCommit(
  principal: Principal,
  planned: PlannedSource,
  target: SourceTarget
): Promise<PlannedSource> {
  assertPlannedBy(principal, planned)
  if (!planned.replan) return planned
  const { submission, loads } = planned.replan
  const replanned = await planSource(
    principal,
    target,
    {
      ...submission,
      pendingResources: (submission.pendingResources ?? []).filter(
        (entry) => entry.kind === 'workflow'
      ),
    },
    { ...(loads ? { loads } : {}), allocate: true }
  )
  if (replanned.kind === 'refused') throw refusalError(replanned)
  return replanned
}

/** A plan refused: the findings, and what its dry-run answer echoes. */
export interface RefusedSource {
  kind: 'refused'
  diagnostics: WorkflowSourceDiagnostic[]
  /** Set when the draft moved off the submission's base: a commit answers 409, not 400. */
  stale?: { currentFingerprint: SourceFingerprint; workflowName: string }
  /** What the source references, when it compiled. */
  compiledReferences?: CompiledReferences
  /** The catalog and draft the plan read, and the base fingerprint a dry run echoes. */
  echo: { catalog: BlockCatalog; stored: StoredSource; fingerprint: SourceBase['fingerprint'] }
}

/** The error a write throws for a refused plan: 409 when stale, else 400 (413 over a limit). */
export function refusalError(
  refused: RefusedSource
): WorkflowSourceStaleError | WorkflowSourceRejectedError {
  return refused.stale
    ? new WorkflowSourceStaleError(refused.stale.currentFingerprint, refused.stale.workflowName)
    : new WorkflowSourceRejectedError(refused.diagnostics)
}

/**
 * Plans a source write without writing: loads the target, refuses a base read from another
 * workflow (`E_APPLY_WORKFLOW_MISMATCH`) or a draft that moved since it (`E_APPLY_STALE`), then
 * evaluates the submission onto the stored graph (empty for a new workflow). A new workflow's name
 * is checked free in its folder now, so a taken name refuses the plan, not the write (it throws
 * {@link WorkflowSourceNameTakenError}). A graph no-op is printed once here, to tell whether its
 * source meta changes. `allocate` lets the load allocate missing resource keys: set it only for a
 * plan that will be committed.
 */
export async function planSource(
  principal: Principal,
  target: SourceTarget,
  submission: SourceSubmission,
  options: { loads?: SourceLoads; allocate: boolean }
): Promise<PlannedSource | RefusedSource> {
  const loaded = await loadSourceTarget(principal, target, options)
  const { catalog, stored, storedFingerprint, scope } = loaded
  return withCatalogBlockScope(loaded.gate, async () => {
    const refuse = (
      diagnostics: WorkflowSourceDiagnostic[],
      extra: Pick<RefusedSource, 'stale' | 'compiledReferences'> = {}
    ): RefusedSource => ({
      kind: 'refused',
      diagnostics,
      ...extra,
      echo: {
        catalog,
        stored,
        fingerprint: target.kind === 'existing' ? target.base.fingerprint : storedFingerprint,
      },
    })

    if (target.kind === 'existing' && target.base.workflowId !== scope.workflowId) {
      return refuse([
        diagnostic(
          'E_APPLY_WORKFLOW_MISMATCH',
          `This source was read from workflow ${target.base.workflowId}, not ${scope.workflowId}; applying it here would overwrite a different workflow.`,
          {
            hint: 'Apply it to the workflow it was read from, or get this workflow’s source into its own directory.',
            path: '/base/workflowId',
          }
        ),
      ])
    }
    if (target.kind === 'existing' && storedFingerprint !== target.base.fingerprint) {
      return refuse([diagnostic('E_APPLY_STALE', workflowSourceStaleMessage(stored.meta.name))], {
        stale: { currentFingerprint: storedFingerprint, workflowName: stored.meta.name },
      })
    }

    const evaluation = await evaluateSource({
      principal,
      scope,
      stored,
      storedCanonical: loaded.storedCanonical,
      storedSourceMeta: loaded.storedSourceMeta,
      catalog,
      envNames: new Set(loaded.envNames),
      createdBy: loaded.createdBy,
      files: submission.files,
      lock: submission.lock,
      ...(submission.pendingResources ? { pendingResources: submission.pendingResources } : {}),
      ...(target.kind === 'existing'
        ? { base: target.base, allowDelete: target.allowDelete }
        : { create: target.create }),
    })
    if ('refused' in evaluation) {
      return refuse(
        evaluation.refused,
        evaluation.compiledReferences ? { compiledReferences: evaluation.compiledReferences } : {}
      )
    }
    const { plan } = evaluation
    const planned: PlannedSource = {
      kind: 'planned',
      workflowId: scope.workflowId,
      boundTo: { principalKey: principalKey(principal) },
      target,
      loaded,
      plan,
    }
    if (
      submission.pendingResources &&
      resolvesPlaceholder(plan.references, submission.pendingResources)
    ) {
      planned.replan = { submission, ...(options.loads ? { loads: options.loads } : {}) }
    }
    if (target.kind === 'new') {
      await assertCreateNameFree(plan, {
        workspaceId: scope.workspaceId,
        folderId: target.folderId,
      })
    }
    if (plan.noop) planned.noop = printNoop(planned)
    return planned
  })
}

/**
 * The stored graph of a graph no-op printed under the name and description the write leaves it
 * with and the source meta it stores, and whether that source meta prints differently from the
 * stored one: only changed source meta prints the "before".
 */
function printNoop(planned: PlannedSource): NonNullable<PlannedSource['noop']> {
  const { plan, loaded } = planned
  const { storedCanonical, stored, storedSourceMeta } = loaded
  const lockless =
    plan.metaChanged.length > 0
      ? {
          ...storedCanonical.canonical,
          workflow: { ...storedCanonical.canonical.workflow, meta: plan.meta },
        }
      : storedCanonical.canonical
  const printed = printPlanned(planned, stored.state, plan.sourceMeta, lockless)
  const before = isEqual(plan.sourceMeta, storedSourceMeta)
    ? printed
    : printPlanned(planned, stored.state, storedSourceMeta, lockless)
  return {
    printed,
    sourceMetaChanged: !isEqual(printed.files, before.files) || !isEqual(printed.lock, before.lock),
  }
}
