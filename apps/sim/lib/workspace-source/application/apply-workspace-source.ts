import { AuditAction, AuditResourceType, withAuditCorrelation } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  APPLY_ORDER,
  type FlatDiagnostic,
  resourceAddress,
  type WorkspaceBaseV1,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isResourceKeyed } from '@sim/workspace-code/kinds/registry'
import { defineAuthorizedWorkspaceUseCase, principalAuditSource } from '@/lib/core/application'
import { recordWorkspaceSourceApplied } from '@/lib/workspace-source/application/analytics'
import { sourceContext } from '@/lib/workspace-source/application/context'
import {
  assertUnchanged,
  isRefusal,
  refusalDiagnostic,
  WorkspaceSourceRejectedError,
} from '@/lib/workspace-source/application/errors'
import { finding, findingIdentity, GET_HINT } from '@/lib/workspace-source/application/findings'
import { claimKey } from '@/lib/workspace-source/application/keys'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import {
  buildWorkspacePlan,
  type WorkspacePlan,
  type WorkspaceSourceSubmission,
} from '@/lib/workspace-source/application/plan'
import { adapterOf } from '@/lib/workspace-source/application/registry'
import { stagingScopeOf } from '@/lib/workspace-source/application/stage-blobs'
import type {
  AppliedResource,
  ApplyContext,
  ChangeAction,
  PlannedChange,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import {
  type ApplyLease,
  acquireApplyLease,
  isApplyLeaseLost,
  WorkspaceSourceBusyError,
} from '@/lib/workspace-source/lease/store'
import {
  markStagedBlobsConsumed,
  readStagedBlob,
  type StagedBlob,
  type StagingScope,
} from '@/lib/workspace-source/staging/store'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { ResourceKeyTakenError } from '@/lib/workspaces/resource-keys'

const logger = createLogger('ApplyWorkspaceSource')

export interface ApplyWorkspaceSourceInput extends WorkspaceSourceSubmission {
  workspaceId: string
  /** Plan, check and authorize everything, then stop before the first write. */
  dryRun?: boolean
  provenance?: ApplyContext['provenance']
}

/** One planned or applied change, as the result reports it. */
interface WorkspaceSourceChange {
  kind: WorkspaceKind
  key: string
  action: ChangeAction
  fields?: string[]
  destructive?: { what: string; counts: Record<string, number> }
  /** The resource's id, once known. */
  id?: string
  /** Held back for a reference the workspace cannot satisfy: not written (see its errors). */
  held?: true
}

export interface ApplyWorkspaceSourceResult {
  workspaceId: string
  dryRun: boolean
  /** Every change the apply plans, no-ops included, in apply order. */
  plan: WorkspaceSourceChange[]
  /**
   * Set on a dry run: whether the apply would refuse, for an error outside the changes held back
   * (those refuse nothing else). Absent on an apply, which a refusal throws instead.
   */
  refuses?: boolean
  /** The changes written, in the order they were written. */
  applied: WorkspaceSourceChange[]
  /**
   * The change that failed mid-apply; everything after it was not attempted. A change written
   * whose key another resource took meanwhile (`E_NAME_TAKEN`) is also in `applied`.
   */
  failed?: { kind: WorkspaceKind; key: string; code: FlatDiagnostic['code']; message: string }
  /**
   * Blob paths a write needs whose bytes the caller has not staged: a dry run lists them so the
   * client stages exactly those; an apply with any is refused (`E_BLOB_MISSING`).
   */
  needBlobs: string[]
  /**
   * The id of an apply that writes (absent on a dry run): every audit entry its writes record
   * carries it as `metadata.correlationId`, as does the apply's own roll-up.
   */
  applyId?: string
  /** Files reprinted from what was stored, for every resource written. */
  files: Record<string, string>
  /** The base after this apply: the next apply's `base`. */
  base: WorkspaceBaseV1
  diagnostics: WorkspaceSourceDiagnostic[]
}

function summarize(change: PlannedChange, id?: string): WorkspaceSourceChange {
  return {
    kind: change.kind,
    key: change.key,
    action: change.action,
    ...(change.fields && change.fields.length > 0 ? { fields: change.fields } : {}),
    ...(change.destructive ? { destructive: change.destructive } : {}),
    ...((id ?? change.storedId) ? { id: id ?? change.storedId } : {}),
    ...(change.held ? { held: true as const } : {}),
  }
}

/**
 * Writes in apply order (creates and updates), then deletes in reverse order; a change held back
 * is not written.
 */
function writeOrder(changes: PlannedChange[]): PlannedChange[] {
  const rank = (kind: WorkspaceKind) => APPLY_ORDER.indexOf(kind)
  const written = changes.filter((change) => !change.held)
  const writes = written.filter((change) => change.action !== 'noop' && change.action !== 'delete')
  const deletes = written.filter((change) => change.action === 'delete')
  return [
    ...writes.sort((a, b) => rank(a.kind) - rank(b.kind)),
    ...deletes.sort((a, b) => rank(b.kind) - rank(a.kind)),
  ]
}

/**
 * What an unexpected write failure says about its cause, by the database's error code (SQLSTATE,
 * or the driver's own): never the error's text, which can quote what was written.
 */
const WRITE_FAILURE_CAUSES: Readonly<Record<string, string>> = {
  '57014': 'a database statement timed out',
  '55P03': 'another write held a lock it needed for too long',
  '40P01': 'it deadlocked with another write',
  '40001': 'it conflicted with a concurrent write',
  '53300': 'the database had no free connection',
  '54000': 'a database statement was larger than the database accepts',
  MAX_PARAMETERS_EXCEEDED: 'a database statement was larger than the database accepts',
}

/** The cause an unexpected write failure names, from its database error code. */
function writeFailureCause(error: unknown): string {
  const code = getPostgresErrorCode(error)
  if (code === undefined) return 'an unexpected server error'
  if (Object.hasOwn(WRITE_FAILURE_CAUSES, code)) return WRITE_FAILURE_CAUSES[code]
  if (code.startsWith('08')) return 'the database connection dropped'
  return `database error ${code}`
}

/**
 * A mid-apply failure as the result reports it; an unexpected one is logged, and named by its
 * cause (see {@link writeFailureCause}) and the apply's id, never echoed. A resource
 * the change found when planning that is gone by its write (deleted since) is stale, like one that
 * changed: getting the directory again shows what the server holds now. A lease another apply took
 * over is a failure applying again continues (`E_APPLY_FAILED`), not a refusal of the change.
 */
function failureOf(
  error: unknown,
  change: PlannedChange,
  applyId: string | undefined
): {
  failed: NonNullable<ApplyWorkspaceSourceResult['failed']>
  diagnostics: WorkspaceSourceDiagnostic[]
} {
  const resource = { kind: change.kind, key: change.key }
  if (error instanceof WorkspaceSourceRejectedError) {
    return {
      failed: { ...resource, code: 'E_APPLY_REFUSED', message: error.message },
      diagnostics: error.diagnostics,
    }
  }
  if (isApplyLeaseLost(error)) {
    const message = `This apply stalled and another apply took over the workspace before ${change.kind} ${change.key}; the changes before it were applied. Apply again once the other apply finished.`
    return {
      failed: { ...resource, code: 'E_APPLY_FAILED', message },
      diagnostics: [finding('E_APPLY_FAILED', message, resource)],
    }
  }
  if (isRefusal(error) && error.code === 'not_found' && change.action !== 'create') {
    const message = `${change.kind} ${change.key} was deleted on the server while this apply ran.`
    return {
      failed: { ...resource, code: 'E_APPLY_STALE', message },
      diagnostics: [finding('E_APPLY_STALE', message, { hint: GET_HINT, ...resource })],
    }
  }
  if (isRefusal(error)) {
    const refusal = refusalDiagnostic(error, resource)
    return {
      failed: { ...resource, code: refusal.code, message: refusal.message },
      diagnostics: [refusal],
    }
  }
  logger.error('Workspace source write failed', {
    ...resource,
    applyId,
    code: getPostgresErrorCode(error),
    error: getErrorMessage(error),
  })
  const message = `Writing ${change.kind} ${change.key} failed (${writeFailureCause(error)}); the changes before it were applied.`
  return {
    failed: { ...resource, code: 'E_APPLY_FAILED', message },
    diagnostics: [
      finding('E_APPLY_FAILED', message, {
        hint: `Apply again: it continues from here. If it fails the same way, report apply ${applyId ?? 'id'} to support.`,
        ...resource,
      }),
    ],
  }
}

/**
 * Writes one change the way every kind's write is enveloped: an update, adopt or delete whose
 * plan recorded the resource's fingerprint first re-reads it and refuses one that moved since
 * (`E_APPLY_STALE`), and a write that binds a source key claims it only once it succeeded, so a
 * failed write leaves the key free and the next apply adopts the resource by name. A write no
 * later apply could adopt (a workflow create) claims its key in its own transaction instead
 * (`keyClaimed`). A key another resource took between the plan and the claim leaves the write
 * committed but unbound: it comes back with `keyTaken`, the `E_NAME_TAKEN` finding that says so.
 */
async function write(
  change: PlannedChange,
  ctx: ApplyContext
): Promise<AppliedResource & { keyTaken?: WorkspaceSourceDiagnostic }> {
  const adapter = adapterOf(change.kind)
  if (change.action !== 'create' && change.storedFingerprint !== undefined) {
    const now = await adapter.storedFingerprintNow?.(change, ctx)
    if (now !== undefined) assertUnchanged(change, now)
  }
  const written = await adapter.apply(change, ctx)
  const claims =
    isResourceKeyed(change.kind) &&
    (adapter.keys === 'every-write'
      ? change.action !== 'delete'
      : change.action === 'create' || change.action === 'adopt')
  if (!claims || written.keyClaimed) return written
  try {
    const claimed = await claimKey(change, ctx, written.id)
    return claimed.length > 0
      ? { ...written, diagnostics: [...(written.diagnostics ?? []), ...claimed] }
      : written
  } catch (error) {
    if (!(error instanceof ResourceKeyTakenError)) throw error
    return {
      ...written,
      keyTaken: refusalDiagnostic(error, { kind: change.kind, key: change.key }),
    }
  }
}

/** The result of `plan` before anything is written: every planned change, none applied yet. */
function planned(
  plan: WorkspacePlan,
  workspaceId: string,
  dryRun: boolean
): ApplyWorkspaceSourceResult {
  return {
    workspaceId,
    dryRun,
    plan: plan.changes.map((change) => summarize(change)),
    ...(dryRun && { refuses: plan.refusing.length > 0 }),
    applied: [],
    needBlobs: plan.needBlobs,
    files: {},
    base: plan.base,
    diagnostics: plan.diagnostics,
  }
}

/** What {@link planWorkspaceSource} reads: a directory as an apply sends it, without its knobs. */
export type PlanWorkspaceSourceInput = Omit<ApplyWorkspaceSourceInput, 'dryRun' | 'provenance'>

/**
 * What an apply of this directory would do, without writing: every planned change and finding,
 * exactly as a dry run reports them. A read, so `sim workspaces source status` costs no write
 * budget; like a dry run it takes no lease and records, audits and notifies nothing.
 */
export const planWorkspaceSource = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.plan,
  resolveContext: ({ input }: { input: PlanWorkspaceSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<ApplyWorkspaceSourceResult> {
    const plan = await buildWorkspacePlan(input, sourceContext(principal, context))
    return planned(plan, context.workspaceId, true)
  },
})

/**
 * Applies a workspace source directory: plans every managed kind, refuses the whole apply when
 * any change has an error (nothing written) apart from the changes held back for a reference the
 * workspace cannot satisfy, which alone are not written, then writes each change through the use
 * case that owns it, in apply order with deletes last and in reverse. The writes commit one by one, so a
 * failure stops the apply and reports what was written before it (`failed`); re-running the same
 * directory converges. The plan and the writes hold the workspace's apply lease, so a second apply
 * meanwhile is refused with nothing read or written (`SOURCE_BUSY`); a dry run takes no lease. Each child
 * use case audits its own write; this records one roll-up.
 */
export const applyWorkspaceSource = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.apply,
  resolveContext: ({ input }: { input: ApplyWorkspaceSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<ApplyWorkspaceSourceResult> {
    const ctx: ApplyContext = {
      ...sourceContext(principal, context),
      writtenDrafts: new Map(),
      ...(input.provenance ? { provenance: input.provenance } : {}),
    }
    if (input.dryRun === true) {
      return planned(await buildWorkspacePlan(input, ctx), context.workspaceId, true)
    }
    const facts = {
      principal,
      client: input.provenance?.client,
      workspaceId: context.workspaceId,
    }
    // One apply plans and writes a workspace at a time, under one lease: a plan made before
    // another apply's writes would write half of itself and then fail (a name taken, a resource
    // changed, a delete another apply started using). A second apply meanwhile is refused
    // (`SOURCE_BUSY`) before it reads anything; a dry run takes no lease.
    const lease = await acquireApplyLease(context.workspaceId).catch((error: unknown) => {
      if (error instanceof WorkspaceSourceBusyError) {
        recordWorkspaceSourceApplied(facts, [], { refused: 'busy' })
      }
      throw error
    })
    try {
      const plan = await buildWorkspacePlan(input, ctx, { requireBlobs: true })
      if (plan.refusing.length > 0) {
        recordWorkspaceSourceApplied(facts, plan.changes, { refused: 'rejected' })
        throw new WorkspaceSourceRejectedError(plan.diagnostics, plan.refusing)
      }
      const result = planned(plan, context.workspaceId, false)
      Object.assign(result.files, plan.reprint)
      const base: WorkspaceBaseV1 = { ...plan.base, resources: { ...plan.base.resources } }
      for (const change of plan.changes) {
        if (change.action === 'noop' && change.base) {
          base.resources[resourceAddress(change.kind, change.key)] = change.base
        }
      }
      const applyId = generateId()
      result.applyId = applyId
      const consumed = await withAuditCorrelation(applyId, () =>
        writeAll(plan.changes, ctx, plan.staged, lease, base, result)
      )
      await consumeStagedBlobs(stagingScopeOf(principal, context.workspaceId), consumed)
      result.base = base
      recordWorkspaceSourceApplied(facts, plan.changes, result)
      logger.info('Applied workspace source', {
        workspaceId: context.workspaceId,
        applyId,
        applied: result.applied.length,
        failed: result.failed !== undefined,
      })
      return result
    } finally {
      await lease.release()
    }
  },
  projectAudit: ({ principal, input, context, result }) =>
    result.applied.length > 0
      ? {
          action: AuditAction.WORKSPACE_UPDATED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: context.workspaceId,
          description: `Applied workspace source: ${result.applied.length} change(s)${result.failed ? `, stopped at ${result.failed.kind} ${result.failed.key}` : ''}`,
          metadata: {
            op: 'apply_workspace_source',
            ...(result.applyId ? { correlationId: result.applyId } : {}),
            changes: result.applied.map(({ kind, key, action }) => `${action} ${kind}:${key}`),
            ...(result.failed ? { failed: `${result.failed.kind}:${result.failed.key}` } : {}),
            ...(input.provenance ? { client: input.provenance.client } : {}),
            ...(input.provenance?.gitSha ? { gitSha: input.provenance.gitSha } : {}),
            ...(input.provenance?.repo ? { repo: input.provenance.repo } : {}),
            source: principalAuditSource(principal),
          },
        }
      : [],
})

/**
 * Marks the staged blobs the apply wrote as consumed, so the payer's quota stops counting bytes
 * the workspace now stores. The writes are already committed, so a failure here is only logged:
 * those blobs keep counting until they expire, as they did before an apply consumed any.
 */
async function consumeStagedBlobs(target: StagingScope, consumed: StagedBlob[]): Promise<void> {
  try {
    await markStagedBlobsConsumed(target, consumed)
  } catch (error) {
    logger.warn('Could not mark staged blobs consumed', {
      workspaceId: target.workspaceId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Writes the plan's changes in write order under `lease`, recording each into `base` and
 * `result`; the first failure stops it and is reported as `result.failed`. Each write reads its
 * binary files from `staged`; returns the staged blobs the writes reported stored, the failed
 * write's included.
 */
async function writeAll(
  changes: PlannedChange[],
  ctx: ApplyContext,
  staged: ReadonlyMap<string, StagedBlob>,
  lease: Pick<ApplyLease, 'confirm'>,
  base: WorkspaceBaseV1,
  result: ApplyWorkspaceSourceResult
): Promise<StagedBlob[]> {
  // A write re-reports what its plan already found: each finding is listed once, with the ids
  // the write gave it.
  const reported = new Map(
    result.diagnostics.map((diagnostic, at) => [findingIdentity(diagnostic), at])
  )
  const consumed: StagedBlob[] = []
  for (const change of writeOrder(changes)) {
    const stagedAt = (path: string) => {
      const blob = staged.get(path)
      if (!blob) throw new Error('A blob write ran without its staged bytes')
      return blob
    }
    const writeCtx: ApplyContext = {
      ...ctx,
      blobs: {
        read: (path) => readStagedBlob(stagedAt(path)),
        stored: (path) => {
          consumed.push(stagedAt(path))
        },
      },
    }
    try {
      await lease.confirm()
      const written = await write(change, writeCtx)
      Object.assign(result.files, written.text)
      for (const diagnostic of written.diagnostics ?? []) {
        const at = reported.get(findingIdentity(diagnostic))
        if (at !== undefined) {
          result.diagnostics[at] = diagnostic
          continue
        }
        reported.set(findingIdentity(diagnostic), result.diagnostics.length)
        result.diagnostics.push(diagnostic)
      }
      result.applied.push(summarize(change, written.id))
      if (written.keyTaken) {
        // Written but not bound to its key, so the base keeps what it held, and a later write
        // resolving the key would reach the resource that holds it: the apply stops here.
        const { code, message } = written.keyTaken
        result.failed = { kind: change.kind, key: change.key, code, message }
        result.diagnostics.push(written.keyTaken)
        break
      }
      const address = resourceAddress(change.kind, change.key)
      if (written.base) base.resources[address] = written.base
      else delete base.resources[address]
    } catch (error) {
      const failure = failureOf(error, change, result.applyId)
      result.failed = failure.failed
      result.diagnostics.push(...failure.diagnostics)
      break
    }
  }
  return consumed
}
