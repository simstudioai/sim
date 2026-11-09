import 'server-only'
import { readOrganizationSurface } from '@/platform/lib/data/surface'
import type { WorkspaceTabFlags } from '@/platform/lib/workspace-navigation'

type WorkspaceTabFlag = keyof WorkspaceTabFlags

/**
 * The rollout flags the workspace tabs depend on, from the surface the shell already read in this
 * request. A surface that did not answer turns every flag off: the shell renders that outcome itself.
 */
export async function readWorkspaceTabFlags(): Promise<WorkspaceTabFlags> {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return {}
  const { featureFlags } = surface.organization
  return {
    dashboards: featureFlags.dashboards,
    changelog: featureFlags.changelog,
    'workflow-tests': featureFlags['workflow-tests'],
  }
}

/** Whether a flagged tab's page exists for the viewer, so a page whose tab is hidden answers 404. */
export async function readWorkspaceTabFlag(flag: WorkspaceTabFlag): Promise<boolean> {
  return (await readWorkspaceTabFlags())[flag] === true
}
