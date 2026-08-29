import { isBlockTypeAllowed } from '@/lib/workflows/editing/validation'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
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
 */
export async function findWithheldBlockType(params: {
  userId: string
  workspaceId: string
  blocks: Iterable<{ type?: string }>
}): Promise<string | null> {
  const permissionConfig = await getUserPermissionConfig(params.userId, params.workspaceId)

  for (const block of params.blocks) {
    const blockType = block.type
    if (!blockType || CONTAINER_BLOCK_TYPES.has(blockType)) continue
    if (!isBlockTypeAllowed(blockType, permissionConfig)) return blockType
  }

  return null
}

/** The refusal text every persist path renders for a withheld block type. */
export function withheldBlockTypeMessage(blockType: string): string {
  return `Block type "${blockType}" is unavailable in this deployment or blocked by access control`
}
