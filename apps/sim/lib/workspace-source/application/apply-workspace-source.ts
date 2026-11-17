import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  APPLY_ORDER,
  resourceAddress,
  type WorkspaceBaseV1,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { isResourceKeyed } from '@sim/workspace-code/kinds/registry'
import { defineAuthorizedWorkspaceUseCase, principalAuditSource } from '@/lib/core/application'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { sourceContext } from '@/lib/workspace-source/application/context'
import {
  assertUnchanged,
  isRefusal,
  refusalDiagnostic,
  WorkspaceSourceRejectedError,
} from '@/lib/workspace-source/application/errors'
import { finding } from '@/lib/workspace-source/application/findings'
import { claimKey } from '@/lib/workspace-source/application/keys'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import {
  planWorkspaceSource,
  type WorkspaceSourceSubmission,
} from '@/lib/workspace-source/application/plan'
import { KIND_ADAPTERS } from '@/lib/workspace-source/application/registry'
import type {
  AppliedResource,
  ApplyContext,
  ChangeAction,
  PlannedChange,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

const logger = createLogger('ApplyWorkspaceSource')

export interface ApplyWorkspaceSourceInput extends WorkspaceSourceSubmission {
  workspaceId: string
  /** Plan, check and authorize everything, then stop before the first write. */
  dryRun?: boolean
  provenance?: ApplyContext['provenance']
}

/** One planned or applied change, as the result reports it. */
export interface WorkspaceSourceChange {
  kind: WorkspaceKind
  key: string
  action: ChangeAction
  fields?: string[]
  destructive?: { what: string; counts: Record<string, number> }
  /** The resource's id, once known. */
  id?: string
}

export interface ApplyWorkspaceSourceResult {
  workspaceId: string
  dryRun: boolean
  /** Every change the apply plans, no-ops included, in apply order. */
  plan: WorkspaceSourceChange[]
  /** The changes written, in the order they were written. */
  applied: WorkspaceSourceChange[]
  /** The change that failed mid-apply; everything after it was not attempted. */
  failed?: { kind: WorkspaceKind; key: string; code: string; message: string }
  /** Blob paths whose content the next round must carry. */
  needBlobs: string[]
  /** Blob writes this round skipped for missing content; the next round continues with them. */
  remainingBlobs: string[]
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
  }
}

/** Writes in apply order (creates and updates), then deletes in reverse order. */
function writeOrder(changes: PlannedChange[]): PlannedChange[] {
  const rank = (kind: WorkspaceKind) => APPLY_ORDER.indexOf(kind)
  const writes = changes.filter((change) => change.action !== 'noop' && change.action !== 'delete')
  const deletes = changes.filter((change) => change.action === 'delete')
  return [
    ...writes.sort((a, b) => rank(a.kind) - rank(b.kind)),
    ...deletes.sort((a, b) => rank(b.kind) - rank(a.kind)),
  ]
}

/** A mid-apply failure as the result reports it; an unexpected one is logged, not echoed. */
function failureOf(
  error: unknown,
  change: PlannedChange
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
  if (isRefusal(error)) {
    const refusal = refusalDiagnostic(error, resource)
    return {
      failed: { ...resource, code: refusal.code, message: refusal.message },
      diagnostics: [refusal],
    }
  }
  logger.error('Workspace source write failed', { ...resource, error: getErrorMessage(error) })
  const message = `Writing ${change.kind} ${change.key} failed; the changes before it were applied.`
  return {
    failed: { ...resource, code: 'E_APPLY_FAILED', message },
    diagnostics: [finding('E_APPLY_FAILED', message, resource)],
  }
}

/**
 * Writes one change the way every kind's write is enveloped: an update, adopt or delete whose
 * plan recorded the resource's fingerprint first re-reads it and refuses one that moved since
 * (`E_APPLY_STALE`), and a write that binds a source key claims it only once it succeeded, so a
 * failed write leaves the key free and the next apply adopts the resource by name.
 */
async function write(change: PlannedChange, ctx: ApplyContext): Promise<AppliedResource> {
  const adapter = KIND_ADAPTERS[change.kind]
  if (change.action !== 'create' && change.serverFingerprint !== undefined) {
    const now = await adapter.fingerprintNow?.(change, ctx)
    if (now !== undefined) assertUnchanged(change, now)
  }
  const written = await adapter.apply(change, ctx)
  const claims =
    isResourceKeyed(change.kind) &&
    (adapter.keys === 'every-write'
      ? change.action !== 'delete'
      : change.action === 'create' || change.action === 'adopt')
  if (!claims) return written
  const claimed = await claimKey(change, ctx, written.id)
  return claimed.length > 0
    ? { ...written, diagnostics: [...(written.diagnostics ?? []), ...claimed] }
    : written
}

/**
 * Applies a workspace source directory: plans every managed kind, refuses the whole apply when
 * any change has an error (nothing written), then writes each change through the use case that
 * owns it, in apply order with deletes last and in reverse. The writes commit one by one, so a
 * failure stops the apply and reports what was written before it (`failed`); re-running the same
 * directory converges. Each child use case audits its own write; this records one roll-up.
 */
export const applyWorkspaceSource = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.apply,
  resolveContext: ({ input }: { input: ApplyWorkspaceSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<ApplyWorkspaceSourceResult> {
    await requireWorkflowCodeEnabled()
    const ctx: ApplyContext = {
      ...sourceContext(principal, context),
      ...(input.provenance ? { provenance: input.provenance } : {}),
    }
    const dryRun = input.dryRun === true
    const plan = await planWorkspaceSource(input, ctx, { decodeBlobs: !dryRun })
    const refused = plan.diagnostics.some((finding) => finding.severity === 'error')
    if (refused && !dryRun) throw new WorkspaceSourceRejectedError(plan.diagnostics)
    const result: ApplyWorkspaceSourceResult = {
      workspaceId: context.workspaceId,
      dryRun,
      plan: plan.changes.map((change) => summarize(change)),
      applied: [],
      needBlobs: plan.needBlobs,
      remainingBlobs: [],
      files: {},
      base: plan.base,
      diagnostics: plan.diagnostics,
    }
    if (dryRun) return result

    const missing = new Set(plan.needBlobs)
    const writeCtx: ApplyContext = {
      ...ctx,
      blobs: { content: plan.carried, complete: missing.size === 0 },
    }
    const base: WorkspaceBaseV1 = { ...plan.base, resources: { ...plan.base.resources } }
    for (const change of plan.changes) {
      if (change.action === 'noop' && change.base) {
        base.resources[resourceAddress(change.kind, change.key)] = change.base
      }
    }
    // Resources this round leaves for a later one, by address.
    const deferred = new Set<string>()
    for (const change of writeOrder(plan.changes)) {
      const waiting = (change.needsBlobs ?? []).filter((path) => missing.has(path))
      result.remainingBlobs.push(...waiting)
      const names = change.refs ?? []
      // A change waits for a later round when this round carries none of its blobs (one that
      // carries some writes those and leaves the rest), when it names a resource that waits, or,
      // for a delete, while any blob is missing, so a resumed apply never deletes early.
      if (
        (waiting.length > 0 && waiting.length === (change.needsBlobs ?? []).length) ||
        names.some((ref) => deferred.has(resourceAddress(ref.kind, ref.key))) ||
        (change.action === 'delete' && missing.size > 0)
      ) {
        deferred.add(resourceAddress(change.kind, change.key))
        continue
      }
      try {
        const written = await write(change, writeCtx)
        const address = resourceAddress(change.kind, change.key)
        if (written.base) base.resources[address] = written.base
        else delete base.resources[address]
        Object.assign(result.files, written.text)
        result.diagnostics.push(...(written.diagnostics ?? []))
        result.applied.push(summarize(change, written.id))
      } catch (error) {
        const failure = failureOf(error, change)
        result.failed = failure.failed
        result.diagnostics.push(...failure.diagnostics)
        break
      }
    }
    result.base = base
    logger.info('Applied workspace source', {
      workspaceId: context.workspaceId,
      applied: result.applied.length,
      failed: result.failed !== undefined,
    })
    return result
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
            changes: result.applied.map(({ kind, key, action }) => `${action} ${kind}:${key}`),
            ...(result.failed ? { failed: `${result.failed.kind}:${result.failed.key}` } : {}),
            ...(input.provenance ? { client: input.provenance.client } : {}),
            ...(input.provenance?.gitSha ? { gitSha: input.provenance.gitSha } : {}),
            source: principalAuditSource(principal),
          },
        }
      : [],
})
