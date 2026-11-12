interface ApolloAuthentication {
  apiKey: string
  credentialType?: string
}

/** Whether the resolved credential is an Apollo OAuth access token rather than an API key. */
export function isApolloOAuthCredential(credentialType: string | undefined): boolean {
  return credentialType === 'oauth' || credentialType === 'managed_oauth'
}

/** Preserves API-key authentication while sending saved OAuth tokens as bearer credentials. */
export function getApolloAuthHeaders(params: ApolloAuthentication): Record<string, string> {
  return isApolloOAuthCredential(params.credentialType)
    ? { Authorization: `Bearer ${params.apiKey}` }
    : { 'X-Api-Key': params.apiKey }
}
