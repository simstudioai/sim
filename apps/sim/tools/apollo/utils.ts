interface ApolloAuthentication {
  apiKey: string
  credentialType?: string
}

/** Preserves API-key authentication while sending saved OAuth tokens as bearer credentials. */
export function getApolloAuthHeaders(params: ApolloAuthentication): Record<string, string> {
  return params.credentialType === 'oauth' || params.credentialType === 'managed_oauth'
    ? { Authorization: `Bearer ${params.apiKey}` }
    : { 'X-Api-Key': params.apiKey }
}
