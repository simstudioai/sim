import type { SetStateAction } from 'react'
import {
  getChatResourceSelectionId,
  type MothershipResource,
} from '@/lib/mothership/resources/types'

/** The tab each desktop-backed kind currently shows, as resource ids. */
export interface NativeActiveTabIds {
  browser: string | null
  terminal: string | null
}

/**
 * Which resource the panel shows.
 *
 * An explicit selection wins whenever it is still on screen. Otherwise the
 * strip falls back to its last resource — except for the desktop-backed kinds,
 * where the desktop app is already showing the tab the user left the chat on.
 * Preferring that tab is what makes reopening a chat land where the user left
 * it, and deriving it here rather than writing it back means no arrival order
 * of tabs, history or native state can leave a tab the user did not pick
 * stored as their selection.
 */
export function resolveEffectiveResourceId(
  resources: readonly MothershipResource[],
  selectedResourceId: string | null,
  nativeActiveTabIds?: NativeActiveTabIds
): string | null {
  if (resources.length === 0) return null
  if (
    selectedResourceId &&
    resources.some((resource) => getChatResourceSelectionId(resource) === selectedResourceId)
  ) {
    return selectedResourceId
  }
  const fallback = resources[resources.length - 1]
  if (fallback.type === 'browser' || fallback.type === 'terminal') {
    const nativeId = nativeActiveTabIds?.[fallback.type] ?? null
    if (
      nativeId &&
      resources.some((resource) => resource.type === fallback.type && resource.id === nativeId)
    ) {
      return nativeId
    }
  }
  return getChatResourceSelectionId(fallback)
}

export function resolveResourceSelectionUpdate(
  currentResourceId: string | null,
  update: SetStateAction<string | null>
): string | null {
  return typeof update === 'function' ? update(currentResourceId) : update
}

export interface ResourceEventPresentationInput {
  activeResourceId: string | null
  activationRequested: boolean
  panelCollapseOwnedByUser: boolean
  panelCollapsed: boolean
  resourceId: string
  selectionOwnedByUser: boolean
}

export interface ResourceEventPresentation {
  activateResource: boolean
  markActivity: boolean
  revealPanel: boolean
}

/**
 * Resolves how agent resource activity should affect the panel without letting
 * background work override an explicit user choice.
 */
export function resolveResourceEventPresentation({
  activeResourceId,
  activationRequested,
  panelCollapseOwnedByUser,
  panelCollapsed,
  resourceId,
  selectionOwnedByUser,
}: ResourceEventPresentationInput): ResourceEventPresentation {
  const preserveCollapsedPanel = panelCollapsed && panelCollapseOwnedByUser
  const preserveSelection =
    selectionOwnedByUser && activeResourceId !== null && activeResourceId !== resourceId
  const activateResource = activationRequested && !preserveCollapsedPanel && !preserveSelection

  return {
    activateResource,
    markActivity: !activateResource,
    revealPanel: panelCollapsed && activationRequested && !panelCollapseOwnedByUser,
  }
}
