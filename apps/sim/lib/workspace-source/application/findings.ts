/**
 * The findings every kind reports the same way, so the plan reads alike across kinds.
 */
import { KIND_DIRS, resourceAddress, type WorkspaceKind } from '@sim/workspace-code'
import type {
  PlanContext,
  PlannedChange,
  StoredResource,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'

/** How to recover from a refusal that needs a fresh read. */
export const GET_HINT =
  'Run `sim workspaces source get` into a fresh directory, reapply your edit there, and apply again.'

/** `tables/leads`: how a finding names a resource. */
function where(kind: WorkspaceKind, key: string): string {
  return `${KIND_DIRS[kind]}/${key}`
}

export function staleFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return {
    code: 'E_APPLY_STALE',
    severity: 'error',
    message: `${where(kind, key)} changed on the server since this directory was read.`,
    hint: GET_HINT,
    kind,
    key,
  }
}

export function noBaseFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return {
    code: 'E_APPLY_NO_BASE',
    severity: 'error',
    message: `${where(kind, key)} exists on the server, but this directory has no base for it, so the apply cannot tell your edit from a server change.`,
    hint: GET_HINT,
    kind,
    key,
  }
}

export function serverChangedFinding(kind: WorkspaceKind, key: string): WorkspaceSourceDiagnostic {
  return {
    code: 'I_SERVER_CHANGED',
    severity: 'info',
    message: `${where(kind, key)} changed on the server; this directory leaves it as it is, and the next get shows the change.`,
    kind,
    key,
  }
}

/**
 * Resources the server holds that the directory does not declare. Only one the base records (so
 * this directory managed it) is deleted, and only with `--allow-delete`; anything else is kept and
 * named in a warning.
 */
export function planUndeclared<S, D, P>(
  kind: WorkspaceKind,
  desired: ReadonlyMap<string, D>,
  stored: StoredSet<S>,
  ctx: PlanContext,
  destructive: (resource: StoredResource<S>) => { what: string; counts: Record<string, number> }
): PlannedChange<D, P>[] {
  const changes: PlannedChange<D, P>[] = []
  for (const [key, resource] of stored.bound) {
    if (desired.has(key)) continue
    const managed = ctx.base?.resources[resourceAddress(kind, key)]?.id === resource.id
    if (managed && ctx.allowDelete) {
      changes.push({
        kind,
        key,
        action: 'delete',
        storedId: resource.id,
        destructive: destructive(resource),
        diagnostics: [],
      })
      continue
    }
    changes.push({
      kind,
      key,
      action: 'noop',
      storedId: resource.id,
      diagnostics: [
        {
          code: managed ? 'E_APPLY_DELETE_NOT_ALLOWED' : 'W_UNDECLARED',
          severity: managed ? 'error' : 'warning',
          message: managed
            ? `${where(kind, key)} is no longer declared; deleting "${resource.name}" needs --allow-delete.`
            : `"${resource.name}" (${kind} ${key}) is on the server but not in this directory; it is kept.`,
          ...(managed
            ? { hint: 'Pass --allow-delete to delete it, or restore its file to keep it.' }
            : {}),
          kind,
          key,
        },
      ],
    })
  }
  return changes
}
