import { client } from '@/lib/auth/auth-client'
import { captureClientEvent } from '@/lib/posthog/client'
import type { PostHogEventMap } from '@/lib/posthog/events'

type ExternalSignInStarted = PostHogEventMap['external_sign_in_started']

export type SocialSignInProvider = Exclude<ExternalSignInStarted['provider'], 'sso'>

interface StartSocialSignInOptions {
  provider: SocialSignInProvider
  view: NonNullable<ExternalSignInStarted['view']>
  surface: ExternalSignInStarted['surface']
  callbackURL: string
}

/**
 * Leaves for a social identity provider, recording the departure first so
 * drop-off at the provider's consent screen is measurable against the
 * server's `user_created`.
 */
export function startSocialSignIn({
  provider,
  view,
  surface,
  callbackURL,
}: StartSocialSignInOptions) {
  captureClientEvent('external_sign_in_started', { provider, view, surface })
  return client.signIn.social({ provider, callbackURL })
}
