/**
 * Demo-only draft App action bindings.
 *
 * Revision actions require a deploymentVersionId column, but draft preview has
 * no real deployment version. Use a sentinel string that is never allowed on
 * release actions / public gateway pins.
 */

export const DRAFT_DEPLOYMENT_VERSION_SENTINEL = '__sim_draft_binding__'

export function isDraftDeploymentVersionId(deploymentVersionId: string | null | undefined): boolean {
  return deploymentVersionId === DRAFT_DEPLOYMENT_VERSION_SENTINEL
}
