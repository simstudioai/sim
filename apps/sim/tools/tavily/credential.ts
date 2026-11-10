import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Tavily tools take an inline key or a saved Tavily credential. */
export const TAVILY_CREDENTIAL_OAUTH = tokenCredentialOAuth('tavily', { apiKey: 'accessToken' })
