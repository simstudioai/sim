import type { Principal } from '@sim/auth/principal'
import { type BlockVisibilityState, getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isIntegrationDeploymentAvailableForVisibility } from '@/lib/integrations/availability.server'
import { allowedIntegrationTypes, principalUserId } from '@/lib/integrations/principal-scope.server'
import {
  isBlockTypeAccessControlExempt,
  resolveAccessControlBlockType,
} from '@/lib/permission-groups/block-access'
import { listCustomBlocksWithInputsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import type { BlockConfig } from '@/blocks/types'
import { isHiddenUnder } from '@/blocks/visibility/context'
import { withBlockVisibility } from '@/blocks/visibility/server-context'

/**
 * The per-caller, per-workspace state every catalog read is filtered through.
 *
 * A catalog looks like static reference data and is not. Four independent
 * policies decide what a caller may see, and all four are resolved here so the
 * six catalog use cases cannot answer differently.
 */
export interface CatalogGate {
  /** Which unreleased blocks this viewer may see, and which shipped ones are kill-switched. */
  visibility: BlockVisibilityState
  /** Lowercased block types the workspace permits, or `null` when unrestricted. */
  allowedIntegrations: ReadonlySet<string> | null
  /** Workflows this workspace's organization has deployed as blocks. */
  customBlockRows: Awaited<ReturnType<typeof listCustomBlocksWithInputsForWorkspace>>
}

/** Loads the canonical workspace, concealing one the caller cannot reach as absent. */
export async function loadCatalogWorkspaceContext(
  workspaceId: string
): Promise<ActiveWorkspaceApplicationContext> {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

/** Resolves every policy that narrows the catalog for this caller and workspace. */
export async function resolveCatalogGate(
  principal: Principal,
  context: ActiveWorkspaceApplicationContext
): Promise<CatalogGate> {
  const userId = principalUserId(principal)
  const [allowedIntegrations, visibility, customBlockRows] = await Promise.all([
    allowedIntegrationTypes(principal, context.workspaceId),
    getBlockVisibility({
      ...(userId ? { userId } : {}),
      ...(context.workspaceOrganizationId ? { orgId: context.workspaceOrganizationId } : {}),
    }),
    listCustomBlocksWithInputsForWorkspace(context.workspaceId),
  ])
  return { allowedIntegrations, visibility, customBlockRows }
}

/**
 * Whether this caller may see a block at all.
 *
 * THE single predicate for the block catalog: the list filters with it and the
 * detail route 404s on it. Applying a weaker rule to the detail route would let
 * a caller enumerate unrevealed preview blocks one id at a time.
 */
export function isBlockVisibleToCaller(block: BlockConfig, gate: CatalogGate): boolean {
  if (block.hideFromToolbar) return false
  if (isHiddenUnder(gate.visibility, block)) return false
  if (!isIntegrationDeploymentAvailableForVisibility(block.type, gate.visibility)) return false
  return isBlockTypeAllowed(block.type, gate)
}

/** Whether the workspace's permission-group allowlist admits a block type. */
export function isBlockTypeAllowed(blockType: string, gate: CatalogGate): boolean {
  if (gate.allowedIntegrations === null) return true
  if (isBlockTypeAccessControlExempt(blockType)) return true
  return gate.allowedIntegrations.has(resolveAccessControlBlockType(blockType).toLowerCase())
}

/**
 * Runs `read` with the gate's block scope established.
 *
 * `getAllBlocks`/`getBlock` are synchronous and resolve both the viewer's
 * visibility projection and the workspace's custom blocks from
 * AsyncLocalStorage. Outside this scope the visibility resolver returns `null`,
 * which is fail-closed for unreleased blocks but does NOT apply the kill switch
 * — a disabled shipped block would still be listed. The two scopes are
 * independent and nest in either order.
 */
export function withCatalogBlockScope<T>(gate: CatalogGate, read: () => Promise<T>): Promise<T> {
  return withBlockVisibility(gate.visibility, () =>
    withCustomBlockOverlay(gate.customBlockRows, read)
  )
}
