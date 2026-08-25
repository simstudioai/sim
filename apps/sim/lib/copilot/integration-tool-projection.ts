import type { ExposedIntegrationTool } from '@/lib/copilot/integration-tools'
import {
  filterExposedIntegrationTools,
  getExposedIntegrationTools,
} from '@/lib/copilot/integration-tools'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { isIntegrationDeploymentAvailableForVisibility } from '@/lib/integrations/availability.server'
import {
  intersectIntegrationAllowlists,
  toAllowedIntegrationTypes,
} from '@/lib/permission-groups/integration-allowlist'
import {
  collectDeniedOperationIds,
  createToolAccessGate,
  getOperationOptionIds,
  type IsToolAllowed,
  NO_DENIED_OPERATIONS,
} from '@/lib/permission-groups/operation-access'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { BLOCK_REGISTRY } from '@/blocks/registry-maps'

/** The slice of a permission group the integration gate reads. */
export type IntegrationGateConfig = Pick<
  PermissionGroupConfig,
  'allowedIntegrations' | 'deniedTools'
>

/** Everything a surface needs to show a viewer only the integrations they may use. */
export interface ViewerIntegrationProjection {
  /** The exposed tools this viewer may discover and call. */
  tools: ExposedIntegrationTool[]
  /**
   * Lowercased block types the viewer may use; `null` when unrestricted. Held
   * separately because block-owned VFS files are gated on the block, not on a
   * tool.
   */
  allowedBlockTypes: ReadonlySet<string> | null
  /** The group's per-tool denylist, for surfaces that gate operations themselves. */
  isToolAllowed: IsToolAllowed
}

/**
 * The viewer's projection of the exposed integration-tool universe: block
 * visibility, deployment availability, the workspace + env integration
 * allowlists, and the group's per-tool `deniedTools` denylist, applied together.
 *
 * The single entry point for every surface that shows the agent what it may use
 * — VFS stamping, `list_integration_tools`, and the deferred callable-tool
 * payload — so a tool an admin denied cannot be advertised on one surface after
 * being withheld on another, and no surface can forget a gate the others apply.
 */
export function projectIntegrationToolsForViewer(
  vis: BlockVisibilityState | null,
  permissionConfig: IntegrationGateConfig | null | undefined
): ViewerIntegrationProjection {
  const allowedBlockTypes = toAllowedIntegrationTypes(
    intersectIntegrationAllowlists(
      permissionConfig?.allowedIntegrations ?? null,
      getAllowedIntegrationsFromEnv()
    )
  )
  const isToolAllowed = createToolAccessGate(permissionConfig?.deniedTools)

  const tools = filterExposedIntegrationTools(
    getExposedIntegrationTools(),
    vis,
    (owner) =>
      isIntegrationDeploymentAvailableForVisibility(owner.blockType, vis) &&
      (allowedBlockTypes === null || allowedBlockTypes.has(owner.blockType.toLowerCase())),
    isToolAllowed
  )

  return { tools, allowedBlockTypes, isToolAllowed }
}

/**
 * Stable signature of the policy {@link projectIntegrationToolsForViewer} reads,
 * for keying caches whose contents depend on the projection.
 *
 * The projection is only as fresh as what keys it: an entry cached under a
 * viewer's identity alone outlives the policy that produced it, so an admin's
 * change would not take effect until the entry expired. Mirrors
 * `visibilitySignature`, which does the same job for block visibility.
 */
export function integrationGateSignature(config: IntegrationGateConfig | null | undefined): string {
  return JSON.stringify([
    config?.allowedIntegrations ? [...config.allowedIntegrations].sort() : null,
    config?.deniedTools?.length ? [...config.deniedTools].sort() : null,
  ])
}

/** What a viewer's `deniedTools` denylist costs the block schemas they are shown. */
export interface DeniedBlockOperations {
  /**
   * Block type -> the operation ids to withhold, for every block that owns a
   * denied tool and is still worth publishing. The set is empty for a block
   * that declares no operation selector: it has no option to remove, but its
   * `tools` list still has to lose the denied id.
   */
  needsProjection: ReadonlyMap<string, ReadonlySet<string>>
  /** Block types with nothing left to configure, withheld entirely. */
  fullyDenied: ReadonlySet<string>
}

const NO_DENIED_BLOCK_OPERATIONS: DeniedBlockOperations = {
  needsProjection: new Map(),
  fullyDenied: new Set(),
}

/**
 * Resolves what a viewer's per-tool denylist removes from the block schemas.
 *
 * Read off the raw registry rather than the exposed-tool set, because
 * `deniedTools` holds `tools.access` ids verbatim: a denied superseded version
 * has to resolve against the block that declares it, not only against the
 * latest one. Only blocks that actually own a denied tool are inspected, and
 * the pass is skipped outright when nothing is denied — the common case.
 *
 * `deniedTools` is read only to detect that common case; every actual decision
 * goes through `isToolAllowed`, so the two arguments cannot disagree.
 */
export function resolveDeniedBlockOperations(
  deniedTools: readonly string[] | undefined,
  isToolAllowed: IsToolAllowed
): DeniedBlockOperations {
  if (!deniedTools?.length) return NO_DENIED_BLOCK_OPERATIONS

  const needsProjection = new Map<string, ReadonlySet<string>>()
  const fullyDenied = new Set<string>()

  for (const block of Object.values(BLOCK_REGISTRY)) {
    const access = block.tools?.access
    if (!access?.length || access.every(isToolAllowed)) continue

    if (!access.some(isToolAllowed)) {
      fullyDenied.add(block.type)
      continue
    }

    const options = getOperationOptionIds(block)
    if (!options.length) {
      needsProjection.set(block.type, NO_DENIED_OPERATIONS)
      continue
    }

    const deniedOperations = collectDeniedOperationIds(block, options, isToolAllowed)
    if (deniedOperations.size === options.length) {
      fullyDenied.add(block.type)
      continue
    }
    needsProjection.set(block.type, deniedOperations)
  }

  return { needsProjection, fullyDenied }
}
