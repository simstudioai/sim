import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { DeploymentFeatures, DeploymentShape } from '@/lib/api/contracts/workspaces'
import {
  isAccessControlEnabled,
  isAuditLogsEnabled,
  isAzureConfigured,
  isBillingEnabled,
  isChatEnabled,
  isCohereConfigured,
  isCustomBlocksEnabled,
  isDataDrainsEnabled,
  isDataRetentionEnabled,
  isHosted,
  isInboxEnabled,
  isSandboxesEnabled,
  isScimEnabled,
  isSessionPoliciesEnabled,
  isSsoEnabled,
  isUsageMonitoringEnabled,
  isWhitelabelingEnabled,
} from '@/lib/core/config/env-flags'

/**
 * One reader for the deployment's shape: hosted or self-hosted, whether billing and
 * Chat run, which provider credentials the deployment supplies, and which enterprise
 * features its configuration turns on.
 *
 * Server code reads the `env-flags` constants directly and this module only packages
 * them. Browser code must not. Those constants are computed once from the
 * `NEXT_PUBLIC_*` transport the root layout emits, and a document that never ran the
 * root layout — Next's bare `__next_error__` 404 shell, or `global-error` after the
 * root layout threw — leaves every one of them unset for the life of the tab, even
 * after `retry()` or a client-side navigation recovers the app in place. Sim Cloud then
 * renders as self-hosted: API Key fields on hosted models, no Auto model, no billing.
 *
 * Workspace surfaces therefore read the shape the workspace host context carries,
 * resolved on the server per request and seeded here by the host provider before any
 * workspace child renders. The constants remain the fallback only outside a workspace,
 * where the root layout always runs.
 *
 * Block definitions import this module, which puts it in React Server Component graphs
 * (the block registry is loaded by auth and workflow lifecycle code), so it must not
 * import React hooks itself; the seeding hook lives with the client-side host provider.
 */

interface DeploymentShapeState {
  /** Server-resolved shape from the workspace host context; `null` until a workspace mounts. */
  seeded: DeploymentShape | null
  seed: (shape: DeploymentShape) => void
  reset: () => void
}

const useDeploymentShapeStore = create<DeploymentShapeState>()(
  devtools(
    (set) => ({
      seeded: null,
      seed: (shape) => set({ seeded: shape }),
      reset: () => set({ seeded: null }),
    }),
    { name: 'deployment-shape-store' }
  )
)

/**
 * The browser's env fallback, built once per document. The env constants it packages are
 * themselves frozen at module init, so caching changes nothing semantically, and it gives
 * {@link useDeploymentShape} a stable reference that memo dependencies can key on.
 */
let browserEnvFallback: DeploymentShape | null = null

function browserFallbackShape(): DeploymentShape {
  browserEnvFallback ??= resolveDeploymentShape()
  return browserEnvFallback
}

/**
 * The shape this runtime's own configuration resolves to. On the server that is the
 * deployment's truth, and what the workspace host context projects. In the browser it
 * is the `NEXT_PUBLIC_*` fallback: right on every document that ran the root layout,
 * and the only source outside a workspace.
 */
export function resolveDeploymentShape(): DeploymentShape {
  return {
    hosted: isHosted,
    billingEnabled: isBillingEnabled,
    chatEnabled: isChatEnabled,
    azureConfigured: isAzureConfigured,
    cohereConfigured: isCohereConfigured,
    features: {
      accessControl: isAccessControlEnabled,
      auditLogs: isAuditLogsEnabled,
      customBlocks: isCustomBlocksEnabled,
      dataDrains: isDataDrainsEnabled,
      dataRetention: isDataRetentionEnabled,
      inbox: isInboxEnabled,
      sandboxes: isSandboxesEnabled,
      scim: isScimEnabled,
      sessionPolicies: isSessionPoliciesEnabled,
      sso: isSsoEnabled,
      usageMonitoring: isUsageMonitoringEnabled,
      whitelabeling: isWhitelabelingEnabled,
    },
  }
}

function isSameDeploymentShape(seeded: DeploymentShape | null, next: DeploymentShape): boolean {
  if (seeded === null) return false
  if (
    seeded.hosted !== next.hosted ||
    seeded.billingEnabled !== next.billingEnabled ||
    seeded.chatEnabled !== next.chatEnabled ||
    seeded.azureConfigured !== next.azureConfigured ||
    seeded.cohereConfigured !== next.cohereConfigured
  ) {
    return false
  }
  const featureKeys = Object.keys(next.features) as (keyof DeploymentFeatures)[]
  return featureKeys.every((key) => seeded.features[key] === next.features[key])
}

/**
 * Installs the server-resolved shape for browser readers. A no-op on the server, where
 * a module-level store would leak across requests, and when the shape is unchanged, so
 * a host-context refetch or a sibling workspace never notifies subscribers for nothing.
 */
export function seedDeploymentShape(shape: DeploymentShape | undefined): void {
  if (typeof window === 'undefined' || !shape) return
  const { seeded, seed } = useDeploymentShapeStore.getState()
  if (isSameDeploymentShape(seeded, shape)) return
  seed(shape)
}

/** Drops the seeded shape and the cached fallback. For tests; the app never unseeds on purpose. */
export function resetDeploymentShape(): void {
  browserEnvFallback = null
  useDeploymentShapeStore.getState().reset()
}

/**
 * The deployment shape for code that runs outside React, such as block `condition`
 * functions and sub-block visibility. Server callers get the resolved truth; browser
 * callers get the seeded server value inside a workspace, and the `NEXT_PUBLIC_*`
 * fallback elsewhere.
 */
export function getDeploymentShape(): DeploymentShape {
  if (typeof window === 'undefined') return resolveDeploymentShape()
  return useDeploymentShapeStore.getState().seeded ?? browserFallbackShape()
}

/**
 * {@link getDeploymentShape} for components, subscribed to the seeded value. Returns the
 * same object until the shape actually changes, so it is safe as a memo dependency for
 * option lists and other derived values that read the shape outside React.
 */
export function useDeploymentShape(): DeploymentShape {
  const seeded = useDeploymentShapeStore((state) => state.seeded)
  if (seeded) return seeded
  return typeof window === 'undefined' ? resolveDeploymentShape() : browserFallbackShape()
}
