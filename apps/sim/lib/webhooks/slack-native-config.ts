import { env } from '@/lib/core/config/env'

/** Returns the signing secret for the native Sim Slack app when it is configured. */
export function getSlackNativeSigningSecret(): string | null {
  const signingSecret = env.SLACK_SIGNING_SECRET?.trim()
  return signingSecret || null
}
