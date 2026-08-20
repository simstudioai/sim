import { getBaseUrl } from '@/lib/core/utils/urls'

/**
 * The public URL a deployed chat answers on.
 *
 * There is no chat subdomain: `proxy.ts` routes chat purely by the `/chat/`
 * path, so the URL is the app host plus the identifier. The `www.` prefix is
 * stripped because the deployed chat is served on the bare host.
 *
 * Single source of truth for three previously independent constructions — the
 * deploy orchestration, the manage read, and the manage write — which had
 * already drifted onto two different host helpers.
 */
export function buildChatDeploymentUrl(identifier: string): string {
  const baseUrl = getBaseUrl()
  try {
    const url = new URL(baseUrl)
    const host = url.host.startsWith('www.') ? url.host.slice('www.'.length) : url.host
    return `${url.protocol}//${host}/chat/${identifier}`
  } catch {
    return `${baseUrl}/chat/${identifier}`
  }
}
