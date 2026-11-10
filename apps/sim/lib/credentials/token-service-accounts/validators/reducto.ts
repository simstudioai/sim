import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Reducto's list-jobs endpoint answers 200 for a valid key and 401 otherwise; one job, no configs. */
export const validateReductoServiceAccount = tokenCheckValidator({
  serviceLabel: 'Reducto',
  request: ({ apiToken }) => ({
    url: 'https://platform.reducto.ai/jobs?limit=1&exclude_configs=true',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
