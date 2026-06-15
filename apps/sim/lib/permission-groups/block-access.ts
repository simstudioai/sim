import { getBlock } from '@/blocks/registry'

/**
 * Block types that bypass permission-group access control entirely.
 *
 * Two kinds of blocks are exempt:
 *  - `start_trigger`: the universal workflow entry point. A workflow must always
 *    be startable regardless of the configured integration allowlist.
 *  - Legacy blocks (`hideFromToolbar: true`): superseded integration versions and
 *    deprecated blocks. They never appear in the toolbar or the Access Control
 *    admin list, so admins cannot allowlist them — yet they may still live inside
 *    older workflows. Exempting them keeps those workflows runnable instead of
 *    silently blocking blocks the admin had no way to permit.
 *
 * This is the single source of truth shared by both the runtime enforcement
 * paths and the Access Control admin UI so the "hidden from the list" set and
 * the "skipped by enforcement" set never drift apart.
 */
export function isBlockTypeAccessControlExempt(blockType: string): boolean {
  if (blockType === 'start_trigger') return true
  return getBlock(blockType)?.hideFromToolbar === true
}
