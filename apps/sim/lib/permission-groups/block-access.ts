import { getBlock } from '@/blocks/registry'

/**
 * The universal workflow entry point. Every retired entry point resolves to it,
 * and it is never an allowlist row, so both it and anything that resolves to it
 * are exempt.
 */
const UNIVERSAL_ENTRY_POINT = 'start_trigger'

/**
 * Block types that bypass permission-group access control entirely.
 *
 * Three kinds are exempt:
 *  - `start_trigger`: the universal workflow entry point. A workflow must be
 *    startable whatever the integration allowlist says.
 *  - A retired block with no successor. It is hidden from the toolbar and from
 *    the Access Control editor, so an admin has no row to permit it on and
 *    nothing to permit it *as*; denying it would silently break the older
 *    workflows still carrying it.
 *  - A retired entry point — `starter`, `manual_trigger`, `api_trigger`,
 *    `chat_trigger` — whose successor is `start_trigger`. It is judged as the
 *    universal entry point, and the universal entry point is exempt, so it must
 *    be too. The editor never offers `start_trigger` as an allowlist row, so
 *    without this every active allowlist refuses every workflow still carrying
 *    an old starter block.
 *
 * A *superseded* block is deliberately not exempt. Legacy `slack` talks to
 * Slack exactly as `slack_v2` does, so exempting it let an allowlist naming
 * `slack_v2` be satisfied by `slack` — reachable through workflow import, the
 * API, or a Copilot-built workflow, and invisible to the admin who configured
 * the allowlist. It is judged as its successor instead; see
 * {@link resolveAccessControlBlockType}.
 *
 * Shared by the runtime enforcement paths and the Access Control editor, so the
 * set that is hidden and the set that is skipped cannot drift apart.
 */
export function isBlockTypeAccessControlExempt(blockType: string): boolean {
  if (blockType === UNIVERSAL_ENTRY_POINT) return true
  const block = getBlock(blockType)
  if (block?.hideFromToolbar !== true) return false
  const successor = resolveAccessControlBlockType(blockType)
  return successor === blockType || successor === UNIVERSAL_ENTRY_POINT
}

/**
 * The block type an allowlist decision should be made against.
 *
 * A superseded version resolves to the successor its `sunset.replacedBy` names,
 * transitively, so allowing or denying an integration covers every version of
 * it. Without this an admin would have to know each retired id and deny it
 * individually — and could not, since the editor only offers the current ones.
 *
 * A retired block with no successor keeps its own identity and appears in the
 * editor under it, which is the only way an admin can decide about it at all.
 */
export function resolveAccessControlBlockType(blockType: string): string {
  const seen = new Set<string>([blockType])
  let current = blockType

  while (true) {
    const successor = getBlock(current)?.sunset?.replacedBy
    if (!successor || seen.has(successor) || !getBlock(successor)) return current
    seen.add(successor)
    current = successor
  }
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
