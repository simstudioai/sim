import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** ElevenLabs tools take an inline key or a saved ElevenLabs credential. */
export const ELEVENLABS_CREDENTIAL_OAUTH = tokenCredentialOAuth('elevenlabs', {
  apiKey: 'accessToken',
})
