/**
 * Normalizes a server root or versioned OpenAI-compatible URL to the `/v1` API base.
 */
export function getOpenAICompatibleApiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}
