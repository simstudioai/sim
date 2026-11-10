import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing Circleback tags answers 200 for a valid key and 401 otherwise. */
export const validateCirclebackServiceAccount = tokenCheckValidator({
  serviceLabel: 'Circleback',
  request: ({ apiToken }) => ({
    url: 'https://circleback.ai/api/tag',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
