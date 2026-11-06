const FLOW_API_ORIGIN = 'https://backend.branch.flowengineering.com'

/** Normalizes the origin copied from Flow's API settings without accepting request paths. */
export function normalizeFlowOrigin(domain?: string): string {
  const value = domain?.trim() || FLOW_API_ORIGIN
  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    throw new Error('Enter a valid Flow API URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/customer-api', '/customer-api/'].includes(url.pathname)
  ) {
    throw new Error(
      'Flow API URL must be an HTTPS origin or the API settings URL ending in /customer-api'
    )
  }
  return url.origin
}

/** Rejects invalid header values while preserving Flow's workspace identifier. */
export function normalizeFlowWorkspaceId(value: string): string {
  const workspaceId = value.trim()
  if (!workspaceId || workspaceId.length > 256 || /[\u0000-\u0020\u007f]/.test(workspaceId)) {
    throw new Error('Enter the Flow workspace identifier from the end of its MCP URL')
  }
  if (/[/?#\\]/.test(workspaceId)) {
    throw new Error('Enter the Flow workspace identifier, not a URL')
  }
  return workspaceId
}

/** Shared authentication headers for Flow tools, selectors, and credential verification. */
export function flowHeaders(params: {
  accessToken: string
  providerWorkspaceId: string
}): Record<string, string> {
  return {
    'X-API-Key': params.accessToken,
    customer: normalizeFlowWorkspaceId(params.providerWorkspaceId),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}
