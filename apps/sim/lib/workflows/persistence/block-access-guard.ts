import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import {
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'
import { BlockType } from '@/executor/constants'

/**
 * Loop and parallel are canvas containers rather than registry blocks, so they
 * resolve to no integration and an allowlist naming every permitted integration
 * would still withhold them. The editing operations skip them for the same
 * reason, and the two paths must agree or a graph the editor accepts would be
 * refused when it is written back.
 */
const CONTAINER_BLOCK_TYPES: ReadonlySet<string> = new Set([BlockType.LOOP, BlockType.PARALLEL])

/**
 * The first block type in `blocks` that the user's permission group withholds,
 * or `null` when every one of them is permitted.
 *
 * `allowedIntegrations` is checked when a block is added through the editing
 * operations, but a whole-graph write does not go through that path: the caller
 * hands over the finished blocks, naming whatever types it likes. Validating at
 * persist time is what makes the allowlist a property of what is *stored*
 * rather than of one authoring route — otherwise a withheld integration lands
 * in the workspace and is caught only by the executor refusing it mid-run,
 * after the workflow has been saved, shared, and possibly deployed.
 *
 * Only the allowlist, deliberately — not the editor's `isBlockTypeAllowed`,
 * which also refuses blocks hidden from the current viewer. Those two questions
 * differ on a whole-graph write: refusing to *add* a preview block a viewer
 * cannot see is right, while refusing to *store* a graph that already contains
 * one would reject an export taken before the block was gated, and would make a
 * save fail for a reason no permission group set.
 */
export async function findWithheldBlockType(params: {
  userId: string
  workspaceId: string
  blocks: Iterable<{ type?: string }>
}): Promise<string | null> {
  const permissionConfig = await resolvePermissionGroupConfig(
    params.userId,
    params.workspaceId,
    undefined
  )
  const allowed = toAccessControlAllowlist(permissionConfig?.allowedIntegrations ?? null)

  /**
   * Hoisted out of the loop: an unrestricted group is the common case, and every
   * workflow save in every ungoverned workspace would otherwise pay two registry
   * lookups per block to reach the same answer.
   */
  if (allowed === null) return null

  for (const block of params.blocks) {
    const blockType = block.type
    if (!blockType || CONTAINER_BLOCK_TYPES.has(blockType)) continue
    if (isBlockTypeAccessControlExempt(blockType)) continue
    if (!allowed.has(resolveAccessControlBlockType(blockType).toLowerCase())) return blockType
  }

  return null
}

/** The refusal text every persist path renders for a withheld block type. */
export function withheldBlockTypeMessage(blockType: string): string {
  return `Block type "${blockType}" is not allowed by your organization's permission group`
}
