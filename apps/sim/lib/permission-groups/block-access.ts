import { getBlock } from '@/blocks/registry'

/**
 * Block types that bypass permission-group access control entirely.
 *
 * Two kinds are exempt:
 *  - `start_trigger`: the universal workflow entry point. A workflow must be
 *    startable whatever the integration allowlist says.
 *  - A retired block with no successor. It is hidden from the toolbar and from
 *    the Access Control editor, so an admin has no row to permit it on and
 *    nothing to permit it *as*; denying it would silently break the older
 *    workflows still carrying it.
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
  if (blockType === 'start_trigger') return true
  const block = getBlock(blockType)
  return block?.hideFromToolbar === true && resolveAccessControlBlockType(blockType) === blockType
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
