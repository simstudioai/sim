import type { WorkspaceSettingsKey } from '@/platform/lib/data/workspace-settings'

/**
 * What a workspace Settings section receives. Its navigation gate has already passed; its own API
 * calls enforce the same rule. A section reads what it may change from `useWorkspaceSettingsSection`.
 */
export interface WorkspaceSettingsSectionProps {
  workspaceId: string
  /** Segments after the section's key, limited to its declared `subpaths`. */
  subpath: readonly string[]
}

/**
 * The segments a section accepts after its key; any other path under it is not found. Each
 * section's code loads from `workspace-settings-section`. None takes one today: a record's detail
 * opens through `useSettingsSubview`, in the query string.
 */
export const WORKSPACE_SETTINGS_SUBPATHS: Partial<Record<WorkspaceSettingsKey, readonly string[]>> =
  {}
