import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { ProjectSection } from '@/app/playground/org/lib/routes'
import { DEFAULT_SETTINGS_SECTION } from '@/app/playground/org/lib/settings-nav'

interface WorkspacePaneState {
  /** The project the workspace tab shows; shared by every chat. */
  projectId: string
  section: ProjectSection
  settingsSection: string
  setProject: (projectId: string) => void
  setSection: (section: ProjectSection) => void
  setSettingsSection: (settingsSection: string) => void
}

export const useWorkspacePane = create<WorkspacePaneState>()(
  devtools(
    (set) => ({
      projectId: 'support',
      section: 'dashboard',
      settingsSection: DEFAULT_SETTINGS_SECTION,
      setProject: (projectId) => set({ projectId, section: 'dashboard' }),
      setSection: (section) => set({ section }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),
    }),
    { name: 'workspace-pane' }
  )
)
