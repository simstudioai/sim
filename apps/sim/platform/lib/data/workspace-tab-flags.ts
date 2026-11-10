import 'server-only'
import { readOrganizationSurface } from '@/platform/lib/data/surface'
import {
  isWorkspaceTabShown,
  type WorkspaceTab,
  type WorkspaceTabFlags,
} from '@/platform/lib/workspace-navigation'

/**
 * The flags the workspace tabs depend on, from the surface the shell already read in this request.
 * A surface that did not answer turns every flag off: the shell renders that outcome itself.
 */
export async function readWorkspaceTabFlags(): Promise<WorkspaceTabFlags> {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') return {}
  const { featureFlags } = surface.organization
  return {
    dashboards: featureFlags.dashboards,
    changelog: featureFlags.changelog,
    'workflow-tests': featureFlags['workflow-tests'],
    'platform-preview': featureFlags['platform-preview'],
  }
}

/** Whether live data lists `section` for the viewer, so a page whose tab is not shown answers 404. */
export async function readWorkspaceTabShown(section: WorkspaceTab): Promise<boolean> {
  return isWorkspaceTabShown(section, await readWorkspaceTabFlags())
}
