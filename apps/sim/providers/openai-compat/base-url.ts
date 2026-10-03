/**
 * Normalizes a server root or versioned OpenAI-compatible URL to the `/v1` API base.
 *
 * @throws When the URL contains query parameters or a fragment.
 */
export function getOpenAICompatibleApiBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim())
  if (url.search || url.hash) {
    throw new Error('OpenAI-compatible base URL must not include query parameters or a fragment')
  }

  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`
  return url.toString()
}
