import { BlockList, isIP } from 'node:net'
import { unwrapIpv6Brackets } from './hostnames'

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }

/**
 * Lowercase wins when set, but an empty lowercase variable counts as unset, so it cannot hide
 * the uppercase one (undici's `EnvHttpProxyAgent` lets an empty `no_proxy` hide `NO_PROXY`).
 */
function readEnv(lower: string, upper: string): string | undefined {
  return process.env[lower]?.trim() || process.env[upper]?.trim() || undefined
}

/** Whether any `HTTPS_PROXY` / `HTTP_PROXY` is set, before any destination is considered. */
export function isEnvironmentProxyConfigured(): boolean {
  return Boolean(readEnv('https_proxy', 'HTTPS_PROXY') ?? readEnv('http_proxy', 'HTTP_PROXY'))
}

type NoProxyRule =
  | { kind: 'domain'; domain: string; port: number }
  | { kind: 'address'; family: 'ipv4' | 'ipv6'; addresses: BlockList; port: number }

function ipFamily(address: string): 'ipv4' | 'ipv6' | null {
  const version = isIP(address)
  return version === 4 ? 'ipv4' : version === 6 ? 'ipv6' : null
}

/**
 * Parses one `NO_PROXY` entry, or null when it can never match. A bracketed IPv6 address may
 * carry a port (`[::1]:8080`); a bare one (`::1`) never does, since its last group reads as one.
 */
function parseNoProxyEntry(entry: string): NoProxyRule | null {
  let host = entry
  let port = 0
  const bracketed = entry.match(/^\[([^\]]+)\](?::(\d+))?$/)
  const withPort = entry.match(/^(.+):(\d+)$/)
  if (bracketed) {
    host = bracketed[1]
    port = bracketed[2] ? Number(bracketed[2]) : 0
  } else if (withPort && isIP(entry.split('/')[0]) !== 6) {
    host = withPort[1]
    port = Number(withPort[2])
  }
  const [address, prefix, ...rest] = host.split('/')
  const family = ipFamily(address)
  if (rest.length > 0) return null
  if (!family) return { kind: 'domain', domain: host.replace(/^\*?\./, '').toLowerCase(), port }
  const addresses = new BlockList()
  try {
    if (prefix === undefined) addresses.addAddress(address, family)
    else if (/^\d+$/.test(prefix)) addresses.addSubnet(address, Number(prefix), family)
    else return null
  } catch {
    return null
  }
  return { kind: 'address', family, addresses, port }
}

/** The last parsed `NO_PROXY`, so each request reuses its rules until the value changes. */
let parsedNoProxy: { raw: string; rules: NoProxyRule[] } | null = null

function noProxyRules(raw: string): NoProxyRule[] {
  if (parsedNoProxy?.raw !== raw) {
    const rules = raw
      .split(/[,\s]/)
      .filter(Boolean)
      .map(parseNoProxyEntry)
      .filter((rule): rule is NoProxyRule => rule !== null)
    parsedNoProxy = { raw, rules }
  }
  return parsedNoProxy.rules
}

/**
 * Whether `NO_PROXY` sends this destination direct, with curl's matching: `*` matches
 * everything; `example.com`, `.example.com` and `*.example.com` all match the domain and
 * every subdomain; `host:port` and `[v6]:port` match only that port; IP entries match any
 * spelling of the address in the same address family; and `10.0.0.0/8` or `fd00::/8` match IP-literal destinations in
 * the range (never a hostname, which is not resolved here).
 */
function isExcludedByNoProxy(hostname: string, port: number): boolean {
  const noProxy = readEnv('no_proxy', 'NO_PROXY')
  if (!noProxy) return false
  if (noProxy === '*') return true
  const host = unwrapIpv6Brackets(hostname.toLowerCase())
  const hostFamily = ipFamily(host)
  return noProxyRules(noProxy).some((rule) => {
    if (rule.port && rule.port !== port) return false
    if (rule.kind === 'address') {
      return hostFamily === rule.family && rule.addresses.check(host, hostFamily)
    }
    return host === rule.domain || host.endsWith(`.${rule.domain}`)
  })
}

/**
 * The operator's `HTTPS_PROXY` / `HTTP_PROXY` for a destination, or null when none applies.
 * Lowercase names win, an https destination falls back to `HTTP_PROXY`, and `NO_PROXY`
 * excludes hosts as {@link isExcludedByNoProxy} describes. Read per call so a value set
 * after startup is honored.
 */
export function resolveEnvironmentProxy(target: URL): string | null {
  const defaultPort = DEFAULT_PORTS[target.protocol]
  if (defaultPort === undefined) return null
  const httpProxy = readEnv('http_proxy', 'HTTP_PROXY')
  const proxy =
    target.protocol === 'https:' ? (readEnv('https_proxy', 'HTTPS_PROXY') ?? httpProxy) : httpProxy
  if (!proxy) return null
  if (isExcludedByNoProxy(target.hostname, Number(target.port) || defaultPort)) return null
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
  if (DEFAULT_PORTS[parsed.protocol] === undefined) {
    throw new Error('The configured HTTP(S)_PROXY must be an http:// or https:// URL')
  }
  return parsed.href
}
