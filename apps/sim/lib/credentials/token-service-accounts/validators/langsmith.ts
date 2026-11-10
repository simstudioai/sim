import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** LangSmith's workspace list answers 200 for a valid API key and 401/403 otherwise. */
export const validateLangsmithServiceAccount = tokenCheckValidator({
  serviceLabel: 'LangSmith',
  request: ({ apiToken }) => ({
    url: 'https://api.smith.langchain.com/api/v1/workspaces',
    headers: { 'X-Api-Key': apiToken, Accept: 'application/json' },
  }),
})
