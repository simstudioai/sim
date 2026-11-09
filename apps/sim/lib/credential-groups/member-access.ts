/**
 * Who has a member integrations inventory at all: the rule behind the member Integrations page.
 * Kept apart from the inventory's projection so a route deciding which page to serve stays light.
 */
export function canReadMemberIntegrations(surface: {
  searchAccess: { memberScoped: boolean }
  viewer: { canConnectSearchIntegrations: boolean }
  connectedAccountsAvailable: boolean
}): boolean {
  return (
    surface.searchAccess.memberScoped &&
    surface.viewer.canConnectSearchIntegrations &&
    surface.connectedAccountsAvailable
  )
}
