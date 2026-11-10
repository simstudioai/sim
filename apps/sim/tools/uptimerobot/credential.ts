import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** UptimeRobot tools take an inline key or a saved UptimeRobot credential. */
export const UPTIMEROBOT_CREDENTIAL_OAUTH = tokenCredentialOAuth('uptimerobot', {
  apiKey: 'accessToken',
})
