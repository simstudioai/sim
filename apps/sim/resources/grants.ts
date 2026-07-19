import type { ResourceKind } from '@/resources/kinds'

/**
 * What the current viewer may do with the mounted resource.
 *
 * Independent capabilities, not a rank — a viewer is never "level 2".
 */
export interface ResourceGrants {
  /** May mutate the resource's own content (edit a file, write table rows). */
  readonly write: boolean
  /**
   * Which workflow state this viewer may execute.
   *
   * NOT a rank either. The server authorizes execution at read OR write
   * depending on the payload: write is required only when the request carries
   * `useDraftState` / `workflowStateOverride` / `rawRunFromBlock` — exactly the
   * fields the public contracts strip. `'deployed'` is therefore available to a
   * read-only viewer, and `'draft'` is the strictly larger capability.
   */
  readonly run: 'none' | 'deployed' | 'draft'
}

/**
 * The permission flags a workspace membership resolves to. Declared structurally
 * so the pure resource layer never imports the React permission hook — any
 * value carrying these three booleans satisfies it.
 */
export interface WorkspacePermissionSnapshot {
  readonly canRead: boolean
  readonly canEdit: boolean
  readonly canAdmin: boolean
}

/**
 * Translate a workspace membership into grants.
 *
 * Callers must not assume the permission provider throws when it is missing: its
 * context default is a concrete zero-capability object, so a component mounted
 * outside the provider renders with no capabilities instead of failing loudly.
 * That is precisely the state this function maps to `run: 'none'`.
 */
export function grantsFromPermissions(permissions: WorkspacePermissionSnapshot): ResourceGrants {
  const { canRead, canEdit } = permissions
  return {
    write: canEdit,
    run: canEdit ? 'draft' : canRead ? 'deployed' : 'none',
  }
}

/**
 * Grants for an anonymous share visitor.
 *
 * A share never writes. It runs only where the public surface has an execution
 * route at all — a shared interface, whose chat and form modules submit through
 * token-scoped routes that execute the **deployed** state. Every other kind is
 * served read-only bytes.
 */
export function grantsForShare(kind: ResourceKind): ResourceGrants {
  return {
    write: false,
    run: kind === 'interface' ? 'deployed' : 'none',
  }
}
