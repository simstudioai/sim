/** Starts OAuth through the existing enrollment boundary, which owns authentication and PKCE. */
export function createCredentialGroupOAuthStartUrl(input: {
  invitationLink: string
  optionId: string
  returnTo: 'search' | 'accounts'
}): string {
  const invitation = new URL(input.invitationLink)
  const token = invitation.pathname.match(/^\/credential-groups\/enroll\/([^/]+)$/)?.[1]
  if (!token) throw new Error('Invalid credential group enrollment link')
  const url = new URL(
    `/api/credential-groups/enroll/${encodeURIComponent(decodeURIComponent(token))}/oauth/${encodeURIComponent(input.optionId)}`,
    invitation.origin
  )
  url.searchParams.set('returnTo', input.returnTo)
  return url.toString()
}

/** Uses the managed MCP enrollment boundary for personal OAuth and PKCE. */
export function createCredentialGroupMcpOAuthStartUrl(
  invitationLink: string,
  mcpServerId: string
): string {
  const invitation = new URL(invitationLink)
  const token = invitation.pathname.match(/^\/credential-groups\/enroll\/([^/]+)$/)?.[1]
  if (!token) throw new Error('Invalid credential group enrollment link')
  return new URL(
    `/api/credential-groups/enroll/${encodeURIComponent(decodeURIComponent(token))}/mcp/${encodeURIComponent(mcpServerId)}`,
    invitation.origin
  ).toString()
}
