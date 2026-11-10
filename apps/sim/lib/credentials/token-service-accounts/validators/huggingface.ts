import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Hugging Face's whoami-v2 endpoint answers 200 for any valid access token and 401 otherwise. */
export const validateHuggingfaceServiceAccount = tokenCheckValidator({
  serviceLabel: 'Hugging Face',
  request: ({ apiToken }) => ({
    url: 'https://huggingface.co/api/whoami-v2',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
