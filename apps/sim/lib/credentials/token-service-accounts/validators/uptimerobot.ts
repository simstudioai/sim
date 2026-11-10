import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** UptimeRobot's v3 user/me returns the key owner's profile, so it succeeds only for a valid key. */
export const validateUptimeRobotServiceAccount = tokenCheckValidator({
  serviceLabel: 'UptimeRobot',
  request: ({ apiToken }) => ({
    url: 'https://api.uptimerobot.com/v3/user/me',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
