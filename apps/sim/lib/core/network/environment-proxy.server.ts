const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }
const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:'])

/** An empty lowercase variable counts as unset, so it cannot hide the uppercase one. */
function readEnv(lower: string, upper: string): string | undefined {
  return process.env[lower]?.trim() || process.env[upper]?.trim() || undefined
}

/** Matches `NO_PROXY` the way undici's `EnvHttpProxyAgent` does, so both stacks agree. */
function isExcludedByNoProxy(hostname: string, port: number): boolean {
  const noProxy = readEnv('no_proxy', 'NO_PROXY')
  if (!noProxy) return false
  if (noProxy === '*') return true
  for (const entry of noProxy.split(/[,\s]/)) {
    if (!entry) continue
    const withPort = entry.match(/^(.+):(\d+)$/)
    const entryHost = (withPort ? withPort[1] : entry).replace(/^\*?\./, '').toLowerCase()
    const entryPort = withPort ? Number.parseInt(withPort[2], 10) : 0
    if (entryPort && entryPort !== port) continue
    if (hostname === entryHost || hostname.endsWith(`.${entryHost}`)) return true
  }
  return false
}

/**
 * The operator's `HTTPS_PROXY` / `HTTP_PROXY` for a destination, or null when none applies.
 * Lowercase names win, an https destination falls back to `HTTP_PROXY`, and `NO_PROXY`
 * excludes hosts with undici's `EnvHttpProxyAgent` matching, so guarded requests leave the
 * way the default `fetch` does. Read per call so a value set after startup is honored.
 */
export function resolveEnvironmentProxy(target: URL): string | null {
  const defaultPort = DEFAULT_PORTS[target.protocol]
  if (defaultPort === undefined) return null
  const httpProxy = readEnv('http_proxy', 'HTTP_PROXY')
  const proxy =
    target.protocol === 'https:' ? (readEnv('https_proxy', 'HTTPS_PROXY') ?? httpProxy) : httpProxy
  if (!proxy) return null
  const hostname = target.host.replace(/:\d*$/, '').toLowerCase()
  const port = Number.parseInt(target.port, 10) || defaultPort
  if (isExcludedByNoProxy(hostname, port)) return null
  return normalizeProxyUrl(proxy)
}

/** Accepts a bare `host:port`, as curl does; anything unparseable fails rather than going direct. */
function normalizeProxyUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.includes('://') ? value : `http://${value}`)
  } catch {
    throw new Error('The configured HTTP(S)_PROXY is not a valid URL')
  }
  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('The configured HTTP(S)_PROXY must be an http:// or https:// URL')
  }
  return parsed.href
}
