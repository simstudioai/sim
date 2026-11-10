import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Tavily's usage endpoint answers 200 for a valid key and 401 otherwise. */
export const validateTavilyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Tavily',
  request: ({ apiToken }) => ({
    url: 'https://api.tavily.com/usage',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
