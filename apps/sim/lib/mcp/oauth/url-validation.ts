import { isLoopbackHostname } from '@/lib/core/utils/urls'

export class McpOauthInsecureUrlError extends Error {
  constructor(url: string) {
    super(`MCP OAuth requires https for non-loopback hosts: ${url}`)
    this.name = 'McpOauthInsecureUrlError'
  }
}

/**
 * MCP spec §2.1 and RFC 8252 §7.3: OAuth flows must run over https, with
 * http allowed only for loopback addresses during local development.
 */
export function assertSafeOauthServerUrl(rawUrl: string | null | undefined): URL {
  if (!rawUrl) throw new McpOauthInsecureUrlError(String(rawUrl))
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new McpOauthInsecureUrlError(rawUrl)
  }
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) return parsed
  throw new McpOauthInsecureUrlError(rawUrl)
}
