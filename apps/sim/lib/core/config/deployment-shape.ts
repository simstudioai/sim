import type { EnterpriseFeatureState } from '@sim/deployment-config/enterprise-features'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  type DeploymentFeatures,
  type DeploymentShape,
  deploymentShapeSchema,
} from '@/lib/api/contracts/workspaces'
import { readDeploymentProjection } from '@/lib/core/config/deployment-projection'
import {
  getRegistrationMode,
  isAccessControlEnabled,
  isAuditLogsEnabled,
  isAzureConfigured,
  isBillingEnabled,
  isChatEnabled,
  isCohereConfigured,
  isCredentialGroupsEnabled,
  isCustomBlocksEnabled,
  isDataDrainsEnabled,
  isDataRetentionEnabled,
  isForkingEnabled,
  isHosted,
  isInboxEnabled,
  isOrganizationsEnabled,
  isSandboxesEnabled,
  isScimEnabled,
  isSessionPoliciesEnabled,
  isSsoEnabled,
  isUsageMonitoringEnabled,
} from '@/lib/core/config/env-flags'

/**
 * One reader for the deployment's shape: hosted or self-hosted, whether billing and
 * Chat run, which provider credentials the deployment supplies, and which enterprise
 * features its configuration turns on.
 *
 * Server code reads the `env-flags` constants directly and this module only packages
 * them. Browser code must not. In the browser those constants are computed once, at
 * module init, from what the root layout emits: the `NEXT_PUBLIC_*` transport and the
 * server-resolved shape projected on `<html>` (`./deployment-projection`). A document
 * that never ran the root layout — Next's bare `__next_error__` 404 shell, or
 * `global-error` after the root layout threw — carries neither, which leaves them at
 * self-hosted defaults for the life of the tab, even after `retry()` or a client-side
 * navigation recovers the app in place. Sim Cloud then renders as self-hosted: API Key
 * fields on hosted models, no Auto model, no billing.
 *
 * Workspace, organization, and standalone settings surfaces therefore read a shape
 * resolved on the server per request, seeded here by their provider or shell before any
 * child renders. Elsewhere the browser reads the projected shape, and only without one
 * the `env-flags` constants.
 *
 * Block definitions import this module, which puts it in React Server Component graphs
 * (the block registry is loaded by auth and workflow lifecycle code), so it must not
 * import React hooks itself; the seeding hook lives in `@/hooks/use-seed-deployment-shape`.
 */

interface DeploymentShapeState {
  /** Server-resolved shape seeded by a surface provider; `null` until one mounts. */
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
 * The browser's unseeded shape, built once per document: the server-resolved shape the
 * root layout projected on `<html>`, or, on a document without one, the shape the
 * `env-flags` constants resolve to. Both are fixed for the document, so caching changes
 * nothing semantically, and it gives {@link useDeploymentShape} a stable reference that
 * memo dependencies can key on.
 */
let browserUnseededShape: DeploymentShape | null = null

function browserFallbackShape(): DeploymentShape {
  if (!browserUnseededShape) {
    const projected = deploymentShapeSchema.safeParse(readDeploymentProjection())
    browserUnseededShape = projected.success ? projected.data : resolveDeploymentShape()
  }
  return browserUnseededShape
}

/**
 * The shape this runtime's own configuration resolves to. On the server that is the
 * deployment's truth: what the root layout projects onto `<html>` and the workspace
 * host context carries. A new shape field added here reaches the browser through both
 * with no other change, so it must be safe for any visitor to read. In the browser
 * this is the `env-flags` fallback, used only when no projection exists.
 *
 * `features.sandboxes` is Sandbox *availability* (entitlement and a ready remote
 * provider), not the entitlement alone.
 */
export function resolveDeploymentShape(): DeploymentShape {
  return {
    hosted: isHosted,
    billingEnabled: isBillingEnabled,
    chatEnabled: isChatEnabled,
    azureConfigured: isAzureConfigured,
    cohereConfigured: isCohereConfigured,
    registrationMode: getRegistrationMode(),
    features: {
      accessControl: isAccessControlEnabled,
      auditLogs: isAuditLogsEnabled,
      credentialGroups: isCredentialGroupsEnabled,
      customBlocks: isCustomBlocksEnabled,
      dataDrains: isDataDrainsEnabled,
      dataRetention: isDataRetentionEnabled,
      forking: isForkingEnabled,
      inbox: isInboxEnabled,
      organizations: isOrganizationsEnabled,
      sandboxes: isSandboxesEnabled,
      scim: isScimEnabled,
      sessionPolicies: isSessionPoliciesEnabled,
      sso: isSsoEnabled,
      usageMonitoring: isUsageMonitoringEnabled,
    } satisfies EnterpriseFeatureState,
  }
}

function isSameDeploymentShape(seeded: DeploymentShape | null, next: DeploymentShape): boolean {
  if (seeded === null) return false
  if (
    seeded.hosted !== next.hosted ||
    seeded.billingEnabled !== next.billingEnabled ||
    seeded.chatEnabled !== next.chatEnabled ||
    seeded.azureConfigured !== next.azureConfigured ||
    seeded.cohereConfigured !== next.cohereConfigured ||
    seeded.registrationMode !== next.registrationMode
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

/**
 * Drops the seeded shape and the cached unseeded shape. For tests; the app never unseeds on
 * purpose.
 */
export function resetDeploymentShape(): void {
  browserUnseededShape = null
  useDeploymentShapeStore.getState().reset()
}

/**
 * The deployment shape for code that runs outside React, such as block `condition`
 * functions and sub-block visibility. Server callers get the resolved truth; browser
 * callers get the seeded server value inside a seeded surface, and the projected shape
 * (or, without one, the `env-flags` fallback) elsewhere.
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
