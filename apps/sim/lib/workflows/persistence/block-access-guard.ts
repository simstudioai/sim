import { OrchestrationError } from '@/lib/core/orchestration/types'
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

/**
 * Who a normalized-state write is performed *as*, for permission-group purposes.
 *
 * Both fields are required at every call site, and `null` is spelled out rather
 * than omitted, for the reason `capability` is required on
 * `defineWorkspaceOperation`: an absent declaration cannot be told apart from an
 * unreviewed one. The guard used to sit at individual doors, and the two that
 * never grew one — `PUT /api/v2/workflows/{id}/state` and the Copilot
 * materialize-import — were exactly the doors nobody remembered to add it to.
 *
 * `subjectUserId` is `null` only when the write is not a member's authoring
 * action: an executor run persisting its own graph, a workspace fork copying
 * rows, or workspace creation seeding a starter workflow. A member's group must
 * not govern those, because the writer is the platform rather than the member.
 */
export interface WorkflowPersistGovernance {
  /** Canonical workspace whose permission groups govern the write, or `null` when it has none. */
  workspaceId: string | null
  /** The human this write is performed as, or `null` when it is performed as no human. */
  subjectUserId: string | null
}

/**
 * Refuses a normalized-state write carrying a block type the writer's permission
 * group withholds.
 *
 * Lives on the shared persistence primitive rather than at each door so a new
 * caller inherits the check instead of having to remember it. A `null` subject
 * or workspace no-ops: there is no group to resolve, and inventing one would
 * either fail open against a bystander's grants or block the executor.
 *
 * Throws {@link OrchestrationError} rather than returning a union, matching the
 * rest of the persistence layer: `statusForOrchestrationError` renders
 * `forbidden` as the 403 the pre-consolidation doors returned, and
 * `messageForOrchestrationError` passes this message through unchanged, so the
 * refusal a caller sees is byte-identical to the one it rendered itself.
 */
export async function assertNoWithheldBlockType(
  governance: WorkflowPersistGovernance,
  blocks: Iterable<{ type?: string }>
): Promise<void> {
  const { workspaceId, subjectUserId } = governance
  if (!workspaceId || !subjectUserId) return

  const withheldBlockType = await findWithheldBlockType({
    userId: subjectUserId,
    workspaceId,
    blocks,
  })
  if (withheldBlockType) {
    throw new OrchestrationError('forbidden', withheldBlockTypeMessage(withheldBlockType))
  }
}
