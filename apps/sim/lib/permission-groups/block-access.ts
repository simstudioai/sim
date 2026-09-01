import {
  intersectAccessControlAllowlists,
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'
import { getBlock } from '@/blocks/registry'

export { intersectAccessControlAllowlists, resolveAccessControlBlockType, toAccessControlAllowlist }

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
 * Whether `blockType` is a row in the Access Control editor's allowlist
 * universe — the set the editor materializes an allowlist from and compares
 * against to collapse one back to `null`.
 *
 * Narrower than {@link isBlockTypeAccessControlExempt} on purpose. A superseded
 * block must stay non-exempt at runtime (legacy `slack` reaches Slack and is
 * judged as `slack_v2`), but it must not be an editor row: the editor renders
 * only visible blocks, so an admin narrowing a previously-unrestricted
 * allowlist by unchecking `slack_v2` would still write the hidden `slack` into
 * it — and canonical resolution then reads that entry as `slack_v2` and allows
 * the very integration the admin just denied.
 *
 * Viewer-independent, like the exemption: it reads the pure registry and the
 * generated successor map, never the visibility projection, so a preview block
 * gated for the acting admin stays in the universe and keeps its stored grant.
 */
export function isAccessControlAllowlistRow(blockType: string): boolean {
  if (isBlockTypeAccessControlExempt(blockType)) return false
  return resolveAccessControlBlockType(blockType) === blockType
}
