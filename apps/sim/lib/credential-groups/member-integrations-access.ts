/** Who has a member integrations inventory at all: the rule behind the member Integrations page. */
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
