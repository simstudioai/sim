import * as ipaddr from 'ipaddr.js'

type IpAddress = ipaddr.IPv4 | ipaddr.IPv6

interface TrustedNetwork {
  address: IpAddress
  prefixLength: number
}

export interface ForwardedIpHeaders {
  get(name: string): string | null
}

export interface ClientIpResolver {
  trustedProxies: string[]
  resolve(headers: ForwardedIpHeaders): string | null
}

function parseForwardedAddress(value: string): IpAddress | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  let candidate = trimmed
  if (trimmed.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed)
    if (!match) return null
    candidate = match[1]
  } else if (trimmed.split(':').length === 2) {
    const match = /^([^:]+):\d+$/.exec(trimmed)
    if (match) candidate = match[1]
  }

  if (!ipaddr.isValid(candidate)) return null
  const address = ipaddr.process(candidate)
  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).zoneId) return null
  return address
}

/** Returns the canonical form of an IP literal, or `null` when it is invalid. */
export function normalizeIpAddress(value: string): string | null {
  return parseForwardedAddress(value)?.toString() ?? null
}

function parseTrustedNetwork(value: string): TrustedNetwork {
  if (value.includes('/')) {
    if (!ipaddr.isValidCIDR(value)) {
      throw new Error(`Invalid AUTH_TRUSTED_PROXIES entry "${value}"`)
    }
    const [address, prefixLength] = ipaddr.parseCIDR(value)
    if (prefixLength === 0) {
      throw new Error(
        `Invalid AUTH_TRUSTED_PROXIES entry "${value}": catch-all networks are unsafe`
      )
    }
    return { address, prefixLength }
  }

  if (!ipaddr.isValid(value)) {
    throw new Error(`Invalid AUTH_TRUSTED_PROXIES entry "${value}"`)
  }
  const address = ipaddr.parse(value)
  return { address, prefixLength: address.kind() === 'ipv4' ? 32 : 128 }
}

function isTrustedProxy(address: IpAddress, networks: TrustedNetwork[]): boolean {
  return networks.some(
    (network) =>
      network.address.kind() === address.kind() &&
      address.match(network.address, network.prefixLength)
  )
}

/**
 * Creates a resolver for proxy-appended `X-Forwarded-For` chains. Resolution
 * walks right to left, skips only explicitly trusted proxy hops, and returns
 * the first untrusted address. With no trusted proxy list, the rightmost value
 * is the only safe address because a reverse proxy appends the network peer
 * after any client-supplied values.
 */
export function createClientIpResolver(trustedProxyConfig?: string): ClientIpResolver {
  const config = trustedProxyConfig?.trim()
  const trustedProxies = config ? config.split(',').map((entry) => entry.trim()) : []
  if (trustedProxies.some((entry) => entry.length === 0)) {
    throw new Error('AUTH_TRUSTED_PROXIES cannot contain empty entries')
  }
  const trustedNetworks = trustedProxies.map(parseTrustedNetwork)

  return {
    trustedProxies,
    resolve(headers) {
      const forwardedFor = headers.get('x-forwarded-for')
      if (!forwardedFor) return null

      const hops = forwardedFor.split(',')
      for (let index = hops.length - 1; index >= 0; index -= 1) {
        const address = parseForwardedAddress(hops[index])
        if (!address) return null
        if (!isTrustedProxy(address, trustedNetworks)) return address.toString()
      }

      return null
    },
  }
}
