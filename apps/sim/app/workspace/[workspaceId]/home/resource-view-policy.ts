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
  const preserveSelection = selectionOwnedByUser && activeResourceId !== resourceId
  const activateResource = activationRequested && !preserveCollapsedPanel && !preserveSelection

  return {
    activateResource,
    markActivity: !activateResource,
    revealPanel: panelCollapsed && activationRequested && !panelCollapseOwnedByUser,
  }
}
