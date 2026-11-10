import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** ElevenLabs returns the key owner's account for a valid key and 401 otherwise. */
export const validateElevenLabsServiceAccount = tokenCheckValidator({
  serviceLabel: 'ElevenLabs',
  request: ({ apiToken }) => ({
    url: 'https://api.elevenlabs.io/v1/user',
    headers: { 'xi-api-key': apiToken, Accept: 'application/json' },
  }),
})
