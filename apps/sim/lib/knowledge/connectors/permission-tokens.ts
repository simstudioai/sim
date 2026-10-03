/** A private connector group cannot grant access to another connector or a provider directory group. */
export function connectorPermissionGroupToken(connectorId: string, groupKey: string): string {
  return `g:connector:${encodeURIComponent(connectorId)}:${encodeURIComponent(groupKey)}`
}
