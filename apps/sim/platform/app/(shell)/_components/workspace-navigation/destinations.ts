import type { ShellWorkspace } from '@/platform/app/(shell)/_components/model'
import { WORKSPACE_PAGES, workspaceEntry, workspacePath } from '@/platform/lib/workspace-navigation'
import type { ShellDestination } from '@/platform/shared/shell'

interface WorkspaceNavigation {
  primary: ShellDestination[]
  pages: ShellDestination[]
  workflows: (ShellDestination & { folder?: string })[]
}

export function workspaceNavigation(
  workspaceId: string,
  workflows: ShellWorkspace['workflows'] = []
): WorkspaceNavigation {
  return {
    primary: [
      { id: 'back', label: 'Back', icon: 'I093', value: '/home' },
      { id: 'new-chat', label: 'New chat', icon: 'I104', value: workspaceEntry(workspaceId) },
      {
        id: 'integrations',
        label: 'Integrations',
        icon: 'I070',
        value: '/integrations',
      },
      { id: 'skills', label: 'Skills', icon: 'I044', value: workspacePath(workspaceId, 'skills') },
    ],
    pages: WORKSPACE_PAGES.map(({ section, label, icon }) => ({
      id: section,
      label,
      icon,
      value: workspacePath(workspaceId, section),
    })),
    workflows: workflows.map(({ id, name, folder }) => ({
      id,
      label: name,
      folder,
      icon: 'I118',
      value: workspacePath(workspaceId, `w/${encodeURIComponent(id)}`),
    })),
  }
}
