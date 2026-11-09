import 'server-only'
import { readOrganizationSurface } from '@/platform/lib/data/surface'
import type { WorkspaceTabFlags } from '@/platform/lib/workspace-navigation'

/**
 * Whether the viewer's organization has workflow tests, from the surface the shell already read in
 * this request. A surface that did not answer shows no Tests: the shell renders that outcome itself.
 */
export async function readWorkflowTestsEnabled(): Promise<boolean> {
  const surface = await readOrganizationSurface()
  return surface.status === 'ok' && surface.organization.featureFlags['workflow-tests']
}

/** The rollout flags the workspace tabs depend on, for the live workspace layout. */
export async function readWorkspaceTabFlags(): Promise<WorkspaceTabFlags> {
  return { 'workflow-tests': await readWorkflowTestsEnabled() }
}
