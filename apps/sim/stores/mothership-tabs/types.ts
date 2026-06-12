import type { MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'

/** A workspace's open tab strip: the tabs and which one is focused. */
export interface WorkspaceTabsState {
  tabs: MothershipResource[]
  activeTabId: string | null
}

/**
 * The resource panel's tab strip, owned by the user per workspace — like
 * browser tabs. Chats only ever merge their artifacts in (additive, deduped);
 * closing, reordering, and focusing are session actions that never touch a
 * chat's artifact provenance.
 */
export interface MothershipTabsState {
  byWorkspace: Record<string, WorkspaceTabsState>
  /**
   * Adds resources to the strip (deduped by `type:id`; ephemeral resources are
   * skipped). Optionally focuses one of them.
   */
  openTabs: (
    workspaceId: string,
    resources: MothershipResource[],
    options?: { focusId?: string }
  ) => void
  /** Removes a tab. Clears focus if the closed tab was active. */
  closeTab: (workspaceId: string, resourceType: MothershipResourceType, resourceId: string) => void
  /** Replaces the strip order (ephemeral entries are dropped). */
  reorderTabs: (workspaceId: string, tabs: MothershipResource[]) => void
  setActiveTab: (workspaceId: string, id: string | null) => void
}
