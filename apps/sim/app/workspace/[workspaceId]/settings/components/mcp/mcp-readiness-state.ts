export type McpReadinessState = 'loading' | 'error' | 'ready'

export interface McpQueryReadiness {
  serversSuccess: boolean
  serversError: boolean
  serversPlaceholder: boolean
  allowedDomainsSuccess: boolean
  allowedDomainsError: boolean
  allowedDomainsPlaceholder: boolean
}

export function resolveMcpReadinessState(state: McpQueryReadiness): McpReadinessState {
  if (state.serversError || state.allowedDomainsError) return 'error'
  if (
    !state.serversSuccess ||
    state.serversPlaceholder ||
    !state.allowedDomainsSuccess ||
    state.allowedDomainsPlaceholder
  ) {
    return 'loading'
  }
  return 'ready'
}
