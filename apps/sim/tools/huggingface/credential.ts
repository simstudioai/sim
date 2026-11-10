import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Hugging Face tools take an inline key or a saved Hugging Face credential. */
export const HUGGINGFACE_CREDENTIAL_OAUTH = tokenCredentialOAuth('huggingface', {
  apiKey: 'accessToken',
})
