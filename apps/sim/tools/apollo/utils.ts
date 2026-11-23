import type { ToolConfig } from '@/tools/types'

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

/**
 * The hidden param every Apollo tool receives the selected credential's type through, so it can
 * tell a saved OAuth token from an API key. Hidden, so neither the user nor the model can fill it;
 * the executor sets it (`APOLLO_CREDENTIAL_OAUTH.authoritativeParams`).
 */
export const APOLLO_CREDENTIAL_TYPE_PARAM = {
  credentialType: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Stored credential type supplied by credential resolution',
  },
} as const satisfies ToolConfig['params']
