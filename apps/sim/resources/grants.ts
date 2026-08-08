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
   * May execute the resource's workflow — the deployed state, which is what
   * every run through a resource view executes. Read access is enough: the
   * server only demands write for the execution controls
   * (`useDraftState`/`workflowStateOverride`/`rawRunFromBlock`) that no resource
   * surface sends.
   */
  readonly run: boolean
  /**
   * May change how the resource is governed rather than what it contains — the
   * admin-only affordances. Table column locks are the first: an owner decides
   * which columns an editor may not touch, which is a different question from
   * whether this viewer may write, and the settings an editor is locked out of
   * are the ones that lock them out.
   *
   * On this axis rather than as a per-view `canAdmin` prop because that is the
   * vocabulary the axis exists to replace — `check-resource-views.ts` bans the
   * name outright.
   */
  readonly manage: boolean
  /**
   * Whether the three capabilities above are final, or still resolving.
   *
   * The one member that describes this *value* rather than the viewer, and it
   * has to sit here: a consumer reading `write === false` cannot otherwise tell
   * "this viewer may not write" from "we do not know yet", because
   * {@link grantsFromPermissions} maps both to the same booleans. Surfaces that
   * render an affordance disabled while permissions load — rather than popping
   * it in afterwards — need that distinction, and one-shot effects need it
   * badly: firing a latched notice before `manage` resolves permanently drops
   * the action it was supposed to carry.
   *
   * `true` wherever capabilities are known at construction, which is every
   * caller that tracks no loading state at all.
   */
  readonly settled: boolean
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
  /**
   * Whether the membership is still being fetched. Optional because a caller
   * that resolves permissions synchronously has no such state — and its absence
   * correctly reads as settled.
   */
  readonly isLoading?: boolean
}

/**
 * Translate a workspace membership into grants.
 *
 * Callers must not assume the permission provider throws when it is missing: its
 * context default is a concrete zero-capability object, so a component mounted
 * outside the provider renders with no capabilities instead of failing loudly.
 * That is precisely the state this function maps to `run: false`.
 */
export function grantsFromPermissions(permissions: WorkspacePermissionSnapshot): ResourceGrants {
  const { canRead, canEdit, canAdmin, isLoading } = permissions
  return {
    write: canEdit,
    run: canEdit || canRead,
    manage: canAdmin,
    settled: !isLoading,
  }
}

/**
 * Grants for an anonymous share visitor.
 *
 * A share never writes, and today never runs: every shareable kind is served as
 * read-only bytes, and never manages. `kind` is taken anyway because running is
 * a per-kind property — it turns on for a kind whose public surface gains an
 * execution route — so callers already pass what that decision will be keyed on.
 *
 * Always settled: an anonymous visitor's capabilities are known the moment the
 * token resolves, so there is no loading state to represent.
 */
export function grantsForShare(_kind: ResourceKind): ResourceGrants {
  return {
    write: false,
    run: false,
    manage: false,
    settled: true,
  }
}
