/**
 * Dependency-free IP / CIDR matching for org network policies.
 *
 * Shared by the Next.js app (auth-time enforcement, contract validation) and
 * the realtime Socket.IO server (handshake enforcement), so it must not
 * import Node-, Next-, or DB-specific modules.
 *
 * Supported entry forms: bare IPv4 (`192.0.2.10`), IPv4 CIDR
 * (`10.0.0.0/16`), bare IPv6 (`2001:db8::1`), IPv6 CIDR (`2001:db8::/48`).
 * Matching never throws: malformed entries and unparseable client addresses
 * simply do not match.
 */

/** Parses an IPv4 address to a 32-bit unsigned integer, or null. */
function parseIpv4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value >>> 0
}

/** Parses an IPv6 address to a 128-bit value as a bigint, or null. */
function parseIpv6(address: string): bigint | null {
  let host = address
  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.10) → expand to two groups.
  const v4Tail = host.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4Tail) {
    const v4 = parseIpv4(v4Tail[2])
    if (v4 === null) return null
    host = `${v4Tail[1]}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }

  const doubleColonSplits = host.split('::')
  if (doubleColonSplits.length > 2) return null

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return []
    const groups = segment.split(':')
    const parsed: number[] = []
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
      parsed.push(Number.parseInt(group, 16))
    }
    return parsed
  }

  let groups: number[]
  if (doubleColonSplits.length === 2) {
    const head = parseGroups(doubleColonSplits[0])
    const tail = parseGroups(doubleColonSplits[1])
    if (!head || !tail || head.length + tail.length > 7) return null
    groups = [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail]
  } else {
    const all = parseGroups(host)
    if (!all || all.length !== 8) return null
    groups = all
  }

  let value = 0n
  for (const group of groups) {
    value = (value << 16n) | BigInt(group)
  }
  return value
}

interface ParsedCidr {
  kind: 'v4' | 'v6'
  value: number | bigint
  prefix: number
}

/** Parses an allowlist entry (bare IP or CIDR), or null when malformed. */
function parseCidr(entry: string): ParsedCidr | null {
  const [host, prefixPart, ...rest] = entry.trim().split('/')
  if (rest.length > 0) return null

  const v4 = parseIpv4(host)
  if (v4 !== null) {
    const prefix = prefixPart === undefined ? 32 : Number(prefixPart)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
    return { kind: 'v4', value: v4, prefix }
  }

  const v6 = parseIpv6(host)
  if (v6 !== null) {
    const prefix = prefixPart === undefined ? 128 : Number(prefixPart)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null
    return { kind: 'v6', value: v6, prefix }
  }

  return null
}

/** True when `entry` is a well-formed bare IP or CIDR allowlist entry. */
export function isValidCidrEntry(entry: string): boolean {
  return parseCidr(entry) !== null
}

/**
 * Compiled allowlist for O(entries) matching without re-parsing per request.
 * Malformed entries are dropped at compile time (report them at save time
 * with {@link isValidCidrEntry} instead).
 */
export interface CompiledAllowlist {
  v4: Array<{ network: number; mask: number }>
  v6: Array<{ network: bigint; prefix: number }>
}

/** Compiles allowlist entries; malformed entries are silently skipped. */
export function compileAllowlist(entries: readonly string[]): CompiledAllowlist {
  const compiled: CompiledAllowlist = { v4: [], v6: [] }
  for (const entry of entries) {
    const parsed = parseCidr(entry)
    if (!parsed) continue
    if (parsed.kind === 'v4') {
      const mask = parsed.prefix === 0 ? 0 : (0xffffffff << (32 - parsed.prefix)) >>> 0
      compiled.v4.push({ network: ((parsed.value as number) & mask) >>> 0, mask })
    } else {
      compiled.v6.push({ network: parsed.value as bigint, prefix: parsed.prefix })
    }
  }
  return compiled
}

/**
 * True when `address` (an IPv4 or IPv6 client address, no CIDR suffix) is
 * inside the compiled allowlist. IPv4-mapped IPv6 addresses
 * (`::ffff:a.b.c.d`) match against the v4 entries. Unparseable addresses
 * never match.
 */
export function isAddressAllowed(address: string, allowlist: CompiledAllowlist): boolean {
  const trimmed = address.trim()

  const mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  const v4 = parseIpv4(mapped ? mapped[1] : trimmed)
  if (v4 !== null) {
    return allowlist.v4.some((entry) => (v4 & entry.mask) >>> 0 === entry.network)
  }

  const v6 = parseIpv6(trimmed)
  if (v6 === null) return false
  return allowlist.v6.some((entry) => {
    if (entry.prefix === 0) return true
    const shift = BigInt(128 - entry.prefix)
    return v6 >> shift === entry.network >> shift
  })
}
