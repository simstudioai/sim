import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** LangSmith tools take an inline key or a saved LangSmith credential. */
export const LANGSMITH_CREDENTIAL_OAUTH = tokenCredentialOAuth('langsmith', {
  apiKey: 'accessToken',
})
