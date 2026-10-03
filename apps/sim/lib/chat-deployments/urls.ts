import { isDev } from '@/lib/core/config/env-flags'
import { getBaseUrl, getEmailDomain } from '@/lib/core/utils/urls'

/**
 * The public URL a deployed chat answers on.
 *
 * There is no chat subdomain: `proxy.ts` routes chat purely by the `/chat/`
 * path, so the URL must preserve the configured app origin, including `www.`
 * and any port. Host aliases may redirect, drop the chat path, or have a
 * different login cookie scope.
 *
 * Single source of truth for the previously independent constructions — the
 * deploy orchestration, the manage read, and the manage write — which had
 * already drifted onto two different host helpers.
 *
 * `getBaseUrl` throws when `NEXT_PUBLIC_APP_URL` is unset, so it is called
 * inside a guard: a self-host missing that variable must still be able to read
 * and update a chat deployment, which is what `getEmailDomain` — the helper the
 * manage routes derived their host from before this consolidation — already
 * falls back for.
 */
export function buildChatDeploymentUrl(identifier: string): string {
  let baseUrl: string
  try {
    baseUrl = getBaseUrl()
  } catch {
    return `${isDev ? 'http' : 'https'}://${getEmailDomain()}/chat/${identifier}`
  }
  return `${baseUrl}/chat/${identifier}`
}
