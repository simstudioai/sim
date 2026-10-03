import { BLOCK_ACCESS_SUCCESSORS } from '@/lib/permission-groups/block-successors.generated'

/**
 * The block type an allowlist decision about `blockType` is really made against.
 *
 * A superseded version resolves to the successor its `sunset.replacedBy` names,
 * transitively, so allowing or denying an integration covers every version of
 * it. Without this an admin would have to know each retired id and deny it
 * individually — and could not, since the editor only offers the current ones.
 *
 * A retired block with no successor keeps its own identity and appears in the
 * editor under it, which is the only way an admin can decide about it at all.
 *
 * Reads the generated projection of the registry rather than the registry
 * itself: this module sits under the authorization funnel, which
 * `scripts/check-application-graph.ts` forbids from importing `blocks/`.
 * `check:block-successors` fails the build when the projection drifts.
 */
export function resolveAccessControlBlockType(blockType: string): string {
  return ownSuccessor(blockType) ?? ownSuccessor(blockType.replace(/-/g, '_')) ?? blockType
}

/**
 * Reads the successor map by its own keys only.
 *
 * The generated map is an object literal with an intact prototype, so a bare
 * bracket lookup answers `constructor`, `toString`, `valueOf` and friends with
 * an inherited function. The ids reaching here come from admin-supplied jsonb
 * (`allowedIntegrations`) and from `ALLOWED_INTEGRATIONS`, so a group naming
 * `constructor` made {@link toAccessControlAllowlist} call `.toLowerCase()` on
 * a function and throw — an unclassified 500 on every enforcement path that
 * read that group. `getBlock` guards the registry the same way for the same
 * reason.
 */
function ownSuccessor(blockType: string): string | undefined {
  return Object.hasOwn(BLOCK_ACCESS_SUCCESSORS, blockType)
    ? BLOCK_ACCESS_SUCCESSORS[blockType]
    : undefined
}

/**
 * The allowlist, indexed for membership tests against the block type an
 * allowlist decision is made against. `null` stays `null` — unrestricted, not
 * "nothing allowed".
 *
 * Both sides have to be normalized or they compare different vocabularies. A
 * policy list can name a retired id: `ALLOWED_INTEGRATIONS` is written by hand
 * against whatever ids the author knows, so `ALLOWED_INTEGRATIONS=slack` is the
 * expected way to permit Slack. The checked type is always successor-resolved,
 * so without normalizing the policy the deployment that permitted `slack` would
 * refuse every `slack_v2` block in it.
 */
export function toAccessControlAllowlist(
  allowedIntegrations: readonly string[] | null
): ReadonlySet<string> | null {
  return allowedIntegrations
    ? new Set(
        allowedIntegrations.map((integration) =>
          resolveAccessControlBlockType(integration.toLowerCase()).toLowerCase()
        )
      )
    : null
}

/**
 * Intersects two independent integration policies in the *resolved* vocabulary.
 *
 * Each side is canonicalized before the intersection, not after. A policy list
 * can name a retired id while the other names its successor —
 * `ALLOWED_INTEGRATIONS=slack` against a group naming `slack_v2` — and folding
 * only case leaves those two ids disjoint, intersecting to nothing and hiding
 * an integration both policies allow. `null` stays unrestricted on either side.
 */
export function intersectAccessControlAllowlists(
  first: readonly string[] | null,
  second: readonly string[] | null
): ReadonlySet<string> | null {
  const resolvedFirst = toAccessControlAllowlist(first)
  const resolvedSecond = toAccessControlAllowlist(second)
  if (resolvedFirst === null) return resolvedSecond
  if (resolvedSecond === null) return resolvedFirst
  return new Set([...resolvedFirst].filter((type) => resolvedSecond.has(type)))
}

/**
 * Intersects integration allowlists from independent policy layers, as a list.
 * `null` means unrestricted, while an empty array denies every integration.
 *
 * The list form of {@link intersectAccessControlAllowlists}, for the callers
 * that carry the effective policy on a `PermissionGroupConfig`. It canonicalizes
 * for the same reason and the result is in the same resolved vocabulary, so
 * callers must successor-resolve the type they check against it.
 */
export function intersectIntegrationAllowlists(
  first: readonly string[] | null,
  second: readonly string[] | null
): string[] | null {
  const intersection = intersectAccessControlAllowlists(first, second)
  return intersection === null ? null : [...intersection]
}
