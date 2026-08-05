import type { ResourceKind, ResourceSeed, ShareableKind } from '@/resources/kinds'

/** Why a resource could not be shown. */
export type UnavailableReason = 'missing' | 'transient'

/** A destination a view may want to link to: itself, or another resource by id. */
export type ResourceLink = { to: 'self' } | { to: 'resource'; kind: ResourceKind; id: string }

/** Display noun per kind, used by the copy the base builds. */
const RESOURCE_NOUN: Record<ResourceKind, string> = {
  file: 'file',
  table: 'table',
  interface: 'interface',
  knowledge: 'knowledge base',
  log: 'log',
  schedule: 'scheduled task',
}

interface ResourceSourceBase {
  /**
   * Opaque React Query namespace. NEVER interpreted, NEVER concatenated into a
   * URL, NEVER on the wire.
   *
   * This is the honest replacement for a required `workspaceId: string` that
   * consumers were satisfying with a share **token** just to key a cache — the
   * token is not a workspace id, and a field that lies about what it holds
   * eventually gets sent somewhere that believes it.
   */
  readonly cacheScope: string
  /**
   * The sentence shown when the resource cannot be rendered. Share sources never
   * mention a workspace or an account, so an anonymous visitor cannot tell
   * "does not exist" from "exists, but not yours".
   */
  readonly unavailableCopy: (reason: UnavailableReason) => string
  /**
   * In-app destination for a link, or `null` when none exists. ALWAYS `null` in
   * share scope — there are no workspace routes to send an anonymous visitor
   * to, so nobody can hand-build `/workspace/${token}/…`.
   */
  readonly hrefFor: (link: ResourceLink) => string | null
}

/** Authenticated, workspace-addressed: the resource is reachable by its own id. */
export interface WorkspaceSource<K extends ResourceKind> extends ResourceSourceBase {
  readonly via: 'workspace'
  readonly kind: K
  readonly workspaceId: string
  readonly resourceId: string
  readonly token?: never
  readonly grantId?: never
  readonly seed?: never
}

/**
 * Anonymous, token-addressed: the resource is reachable only as
 * `(token, grantId)`. There is no resource id in scope, so a public renderer
 * cannot address a resource the share does not grant even by accident.
 */
export interface ShareSource<K extends ResourceKind> extends ResourceSourceBase {
  readonly via: 'share'
  readonly kind: K
  readonly token: string
  /** Module/grant id — disambiguates two grants of one kind under one token. */
  readonly grantId: string
  readonly seed: ResourceSeed<K>
  readonly workspaceId?: never
  readonly resourceId?: never
}

/**
 * Distributive on purpose. Written as a plain `WorkspaceSource<K> |
 * ShareSource<K>`, the default `K = ResourceKind` produces two arms that each
 * carry the *whole* kind union, so `source.kind === 'file'` narrows nothing and
 * every renderer reading `seed` needs a cast. Distributing turns the default
 * into a union of per-kind sources, so the `kind` check narrows `seed` with it.
 */
export type ResourceSource<K extends ResourceKind = ResourceKind> = K extends ResourceKind
  ? WorkspaceSource<K> | ShareSource<K>
  : never

/**
 * The in-app route for a resource, used by {@link workspaceSource}'s `hrefFor`.
 * The one table — every in-app destination for a resource is spelled here and
 * nowhere else, so a surface cannot drift onto a route that no longer exists.
 */
function resourceHref(workspaceId: string, kind: ResourceKind, id: string): string {
  const workspace = `/workspace/${encodeURIComponent(workspaceId)}`
  const resource = encodeURIComponent(id)
  switch (kind) {
    case 'file':
      return `${workspace}/files/${resource}/view`
    case 'table':
      return `${workspace}/tables/${resource}`
    case 'interface':
      return `${workspace}/interfaces/${resource}`
    case 'knowledge':
      return `${workspace}/knowledge/${resource}`
    case 'log':
      return `${workspace}/logs?executionId=${resource}`
    case 'schedule':
      return `${workspace}/scheduled-tasks?taskId=${resource}`
  }
}

export interface WorkspaceSourceInput<K extends ResourceKind> {
  kind: K
  workspaceId: string
  resourceId: string
}

/** Build the authenticated arm of {@link ResourceSource}. */
export function workspaceSource<K extends ResourceKind>({
  kind,
  workspaceId,
  resourceId,
}: WorkspaceSourceInput<K>): WorkspaceSource<K> {
  const noun = RESOURCE_NOUN[kind]
  return {
    via: 'workspace',
    kind,
    workspaceId,
    resourceId,
    cacheScope: `workspace:${workspaceId}:${kind}:${resourceId}`,
    unavailableCopy: (reason) => {
      switch (reason) {
        case 'missing':
          return `This ${noun} may have been deleted or moved`
        case 'transient':
          return `Something went wrong loading this ${noun}. Try again.`
      }
    },
    hrefFor: (link) =>
      link.to === 'self'
        ? resourceHref(workspaceId, kind, resourceId)
        : resourceHref(workspaceId, link.kind, link.id),
  }
}

export interface ShareSourceInput<K extends ShareableKind> {
  kind: K
  token: string
  grantId: string
  seed: ResourceSeed<K>
}

/**
 * Build the anonymous arm of {@link ResourceSource}.
 *
 * Constrained to {@link ShareableKind}, so a kind with no public surface
 * (`knowledge`, `log`, `schedule`) is rejected at the `kind` argument itself —
 * "no public surface" fails to compile rather than merely leaving `seed`
 * unconstructible.
 */
export function shareSource<K extends ShareableKind>({
  kind,
  token,
  grantId,
  seed,
}: ShareSourceInput<K>): ShareSource<K> {
  const noun = RESOURCE_NOUN[kind]
  return {
    via: 'share',
    kind,
    token,
    grantId,
    seed,
    cacheScope: `share:${token}:${grantId}:${kind}`,
    unavailableCopy: (reason) =>
      reason === 'transient'
        ? `Something went wrong loading this ${noun}. Try again.`
        : `This ${noun} is no longer available`,
    hrefFor: () => null,
  }
}
