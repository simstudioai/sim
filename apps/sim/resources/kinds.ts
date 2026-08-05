/**
 * Every resource a viewer can be mounted against.
 *
 * `folder` is deliberately absent: a folder is organizational structure *inside*
 * files and knowledge, not a thing with its own viewer, grants, or share token.
 * `workflow` is deliberately absent too — mounting a workflow opens a
 * collaborative socket session (it joins and leaves a room), so embedding one
 * ADDS lifecycle rather than re-hosting an existing view.
 */
export const RESOURCE_KINDS = ['file', 'table', 'knowledge', 'log', 'schedule'] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/**
 * Whether an arbitrary string names a resource. For surfaces that carry a wider
 * vocabulary than the resource axis — an `@`-mention also names folders,
 * workflows, and skills — so the ones that ARE resources can be addressed
 * through {@link ResourceSource} instead of a second route table.
 */
export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value)
}

/**
 * What a share token can carry for each kind — the server-resolved payload the
 * public page already proved before it rendered anything.
 *
 * `never` is load-bearing. A kind typed `never` structurally cannot produce a
 * value for `seed`, so {@link ResourceSeed} makes "this kind has no public
 * surface" a **compile-time** fact rather than a runtime check someone can
 * forget: `shareSource({ kind: 'knowledge', … })` does not type-check at all.
 *
 * A kind earns a seed exactly when a public route serves it. `file` has one
 * (`/f/[token]` over `/api/files/public/[token]`); nothing else does yet, so
 * every other kind is `never` and cannot be addressed by a token at all.
 */
export interface ResourceSeedMap {
  file: { name: string; type: string; size: number; version: number }
  table: never
  knowledge: never
  log: never
  schedule: never
}

export type ResourceSeed<K extends ResourceKind> = ResourceSeedMap[K]

/**
 * The kinds a share token can actually carry.
 *
 * A kind whose seed is `never` maps to `never` here and drops out of the union
 * entirely, so it is rejected at the **kind** rather than merely left with an
 * unconstructible `seed`. That distinction matters: `ResourceSeedMap[K]`
 * collapses the `never` members away as soon as `K` widens to `ResourceKind`,
 * which would let a widened call satisfy `seed` with a file's payload while
 * naming `knowledge`.
 */
export type ShareableKind = {
  [K in ResourceKind]: [ResourceSeedMap[K]] extends [never] ? never : K
}[ResourceKind]
