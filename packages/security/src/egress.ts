/**
 * Outbound-request (egress) policy: the single decision layer for "may this
 * deployment connect to this destination?".
 *
 * Pure by construction — no DNS, no environment, no I/O, no deployment-posture
 * global. A policy is a value built once from operator configuration, and every
 * decision is a function of `(destination, policy)`. That is what lets a caller
 * evaluate the hosted and self-hosted postures side by side in one test with no
 * module mocking, and what lets the same policy object be re-applied unchanged
 * to every redirect hop of a request.
 *
 * Two checks, in order:
 *
 * 1. {@link evaluateUrl} — pre-DNS. Scheme shape and port. Resolves fully when
 *    the host is an IP literal, since no lookup is needed to classify one.
 * 2. {@link evaluateAddress} — authoritative, once per resolved address. This is
 *    the check that must gate the actual connect, because only a resolved
 *    address can be classified (a DNS name says nothing about where it points).
 *
 * The allowlist is an operator statement of "I vouch for this destination", so a
 * match lifts the private-address block, the plain-HTTP restriction, and the
 * port denylist together — those three are one question about one destination,
 * not three independent switches. Cloud metadata endpoints are the deliberate
 * exception and can never be lifted; see {@link METADATA_ADDRESSES}.
 */

import * as ipaddr from 'ipaddr.js'
import { isLoopbackHostname, unwrapIpv6Brackets } from './hostnames'
import { isIpLiteral, isLoopbackIp, isPrivateIp } from './ssrf'

type IpAddress = ipaddr.IPv4 | ipaddr.IPv6

/** Schemes that may ever carry an outbound request. */

/** When a policy tolerates plain HTTP. */
export type InsecureHttpPolicy = 'never' | 'whenVouched' | 'always'

/**
 * Why a destination was refused. Each value maps to exactly one operator-facing
 * remedy, so the set is deliberately no finer than the underlying classifier can
 * actually distinguish.
 */
export type EgressDenyReason =
  /** Not `http:`/`https:` at all — `file:`, `gopher:`, and friends. */
  | 'scheme-not-permitted'
  /** Plain HTTP to a destination the policy does not vouch for. */
  | 'insecure-scheme'
  /** A port associated with a non-HTTP service, on an unvouched destination. */
  | 'port-denied'
  /** Loopback — called out separately because it is the most common mistake. */
  | 'address-loopback'
  /** Private, reserved, link-local, multicast, or otherwise not publicly routable. */
  | 'address-blocked'
  /** A cloud metadata endpoint. Never liftable by an allowlist. */
  | 'address-metadata'

export type EgressDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: EgressDenyReason; readonly detail: string }

const ALLOWED: EgressDecision = { allowed: true }

function deny(reason: EgressDenyReason, detail: string): EgressDecision {
  return { allowed: false, reason, detail }
}

/**
 * Cloud instance-metadata endpoints, which hand out credentials to anything that
 * can reach them and are therefore the highest-value SSRF target on any managed
 * host. Blocked unconditionally: an operator who allowlists a broad range such
 * as `169.254.0.0/16` must not silently re-expose these.
 */
const METADATA_ADDRESSES: readonly string[] = [
  '169.254.169.254', // AWS IMDS, Azure IMDS, GCP, DigitalOcean, Oracle
  '169.254.170.2', // AWS ECS task metadata
  '100.100.100.200', // Alibaba Cloud
  '192.0.0.192', // Oracle Cloud (legacy)
  'fd00:ec2::254', // AWS IMDS over IPv6
]

/**
 * Ports that speak a non-HTTP protocol on a conventional deployment. Refusing
 * them blunts protocol-smuggling through a URL the caller does not control.
 *
 * Lifted for a vouched destination, which is what lets an operator reach their
 * own internal Elasticsearch on 9200 after naming it — so no profile needs to
 * opt out of the list separately.
 */
const DENIED_PORTS: ReadonlySet<number> = new Set([
  22, // SSH
  23, // Telnet
  25, // SMTP
  3306, // MySQL
  5432, // PostgreSQL
  6379, // Redis
  27017, // MongoDB
  9200, // Elasticsearch
])

interface CidrRange {
  readonly address: IpAddress
  readonly prefixLength: number
}

interface HostPattern {
  /** Lowercased host, or the lowercased suffix (including the leading dot) for a wildcard. */
  readonly value: string
  readonly wildcard: boolean
}

/**
 * A resolved, immutable egress policy. Build one with {@link createEgressPolicy};
 * the shape is internal so the matching rules can change without every caller
 * re-deriving them.
 */
export interface EgressPolicy {
  /**
   * When plain HTTP is acceptable. `whenVouched` covers operator-run internal
   * services, which frequently have no TLS; `always` is for a destination whose
   * scheme is fixed by protocol rather than by trust, such as an HTTP proxy.
   */
  readonly insecureHttp: InsecureHttpPolicy
  /**
   * Whether loopback counts as vouched. Separate from the operator allowlist
   * because a service on the same machine needs no naming to be intentional —
   * a single-tenant deployment talking to its own `localhost` is the ordinary
   * case, not a privilege.
   */
  readonly allowLoopback: boolean
  /**
   * Vouches for every private address without naming one. Exists only to
   * reproduce the deprecated `ALLOW_PRIVATE_DATABASE_HOSTS`, which bypassed the
   * address check outright; a named allowlist is the supported form.
   */
  readonly allowPrivate: boolean
  readonly allowedHosts: readonly HostPattern[]
  readonly allowedRanges: readonly CidrRange[]
}

export interface EgressPolicySpec {
  /**
   * Operator-supplied host allowlist. Entries are exact hostnames or a single
   * leading-wildcard label (`*.svc.cluster.local`). Empty or omitted means the
   * policy vouches for nothing.
   */
  readonly allowedHosts?: string | readonly string[]
  /** Operator-supplied CIDR/IP allowlist. */
  readonly allowedRanges?: string | readonly string[]
  /** When plain HTTP is acceptable. Defaults to `never`. */
  readonly insecureHttp?: InsecureHttpPolicy
  /** Whether loopback destinations are vouched for without being allowlisted. */
  readonly allowLoopback?: boolean
  /** Whether every private address is vouched for. See {@link EgressPolicy.allowPrivate}. */
  readonly allowPrivate?: boolean
  /**
   * Names of the settings these lists came from, used verbatim in the error a
   * malformed entry throws so the operator knows which value to fix.
   */
  readonly sourceNames?: { readonly hosts: string; readonly ranges: string }
}

const DEFAULT_SOURCE_NAMES = { hosts: 'allowedHosts', ranges: 'allowedRanges' } as const

function splitEntries(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return []
  const parts = typeof value === 'string' ? value.split(',') : value
  return parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
}

function parseHostPattern(entry: string, sourceName: string): HostPattern {
  const value = unwrapIpv6Brackets(entry.toLowerCase())
  const wildcard = value.startsWith('*.')
  const host = wildcard ? value.slice(2) : value

  if (host.includes('*')) {
    throw new Error(
      `Invalid ${sourceName} entry "${entry}": a wildcard is only supported as a leading "*." label`
    )
  }
  if (host.includes('/') || /\s/.test(host)) {
    throw new Error(
      `Invalid ${sourceName} entry "${entry}": expected a hostname, not a URL or CIDR`
    )
  }
  if (host.length === 0 || host.split('.').some((label) => label.length === 0)) {
    throw new Error(`Invalid ${sourceName} entry "${entry}": every label must be non-empty`)
  }
  if (wildcard && !host.includes('.')) {
    throw new Error(
      `Invalid ${sourceName} entry "${entry}": a wildcard must cover at least two labels, e.g. "*.example.com"`
    )
  }
  return wildcard ? { value: `.${host}`, wildcard: true } : { value: host, wildcard: false }
}

function parseCidrRange(entry: string, sourceName: string): CidrRange {
  if (entry.includes('/')) {
    if (!ipaddr.isValidCIDR(entry)) {
      throw new Error(`Invalid ${sourceName} entry "${entry}"`)
    }
    const [address, prefixLength] = ipaddr.parseCIDR(entry)
    if (prefixLength === 0) {
      throw new Error(`Invalid ${sourceName} entry "${entry}": catch-all networks are unsafe`)
    }
    return { address, prefixLength }
  }

  const value = unwrapIpv6Brackets(entry)
  if (!ipaddr.isValid(value)) {
    throw new Error(`Invalid ${sourceName} entry "${entry}"`)
  }
  const address = ipaddr.parse(value)
  return { address, prefixLength: address.kind() === 'ipv4' ? 32 : 128 }
}

/**
 * Builds a policy from operator configuration. Throws on any malformed entry
 * rather than silently dropping it — a typo in an allowlist would otherwise
 * present as an unexplained connection failure long after startup.
 */
export function createEgressPolicy(spec: EgressPolicySpec = {}): EgressPolicy {
  const sourceNames = spec.sourceNames ?? DEFAULT_SOURCE_NAMES
  return {
    insecureHttp: spec.insecureHttp ?? 'never',
    allowLoopback: spec.allowLoopback ?? false,
    allowPrivate: spec.allowPrivate ?? false,
    allowedHosts: splitEntries(spec.allowedHosts).map((entry) =>
      parseHostPattern(entry, sourceNames.hosts)
    ),
    allowedRanges: splitEntries(spec.allowedRanges).map((entry) =>
      parseCidrRange(entry, sourceNames.ranges)
    ),
  }
}

/** A policy that vouches for nothing — public HTTPS destinations only. */
export const STRICT_EGRESS_POLICY: EgressPolicy = createEgressPolicy()

function matchesHostAllowlist(host: string, policy: EgressPolicy): boolean {
  if (policy.allowedHosts.length === 0) return false
  const clean = unwrapIpv6Brackets(host.toLowerCase())
  return policy.allowedHosts.some((pattern) =>
    pattern.wildcard ? clean.endsWith(pattern.value) : clean === pattern.value
  )
}

function matchesRangeAllowlist(address: string, policy: EgressPolicy): boolean {
  if (policy.allowedRanges.length === 0) return false
  // Canonical form, so an operator's IPv4 CIDR still matches a resolver that
  // answered with the IPv4-compatible IPv6 spelling of the same address.
  const clean = canonicalAddress(address)
  if (clean === null) return false
  const parsed = ipaddr.process(clean)
  return policy.allowedRanges.some(
    (range) =>
      range.address.kind() === parsed.kind() && parsed.match(range.address, range.prefixLength)
  )
}

/** The IPv4 carried in an address's last 32 bits. */
function embeddedIpv4(parts: readonly number[]): string {
  return ipaddr
    .fromByteArray([
      (parts[6] >> 8) & 0xff,
      parts[6] & 0xff,
      (parts[7] >> 8) & 0xff,
      parts[7] & 0xff,
    ])
    .toString()
}

/**
 * IPv6 prefixes whose low 32 bits are the IPv4 destination: the RFC 6052
 * well-known NAT64 prefix `64:ff9b::/96`, and the RFC 6145 IPv4-translated
 * prefix `::ffff:0:0:0/96`.
 */
const IPV4_EMBEDDING_PREFIXES: readonly (readonly number[])[] = [
  [0x0064, 0xff9b, 0, 0, 0, 0],
  [0, 0, 0, 0, 0xffff, 0],
]

/** RFC 8215 local-use NAT64 prefix, `64:ff9b:1::/48`. */
const NAT64_LOCAL_USE_PREFIX = [0x0064, 0xff9b, 0x0001] as const

/**
 * Canonical form of an address, folding every IPv4-in-IPv6 spelling down to the
 * IPv4 it carries. `ipaddr.process` handles the IPv4-mapped form (`::ffff:x`)
 * but leaves the deprecated IPv4-compatible one (`::a.b.c.d`, which the WHATWG
 * URL parser normalizes to `::a9fe:a9fe`), so comparing without this misses the
 * metadata endpoint written that way.
 */
function canonicalAddress(address: string): string | null {
  const clean = unwrapIpv6Brackets(address)
  if (!ipaddr.isValid(clean)) return null

  const parsed = ipaddr.process(clean)
  if (parsed.kind() === 'ipv6') {
    const parts = (parsed as ipaddr.IPv6).parts

    // A DNS64 resolver hands back the IPv4 destination wrapped in a translation
    // prefix. Left unfolded, `64:ff9b::a9fe:a9fe` does not read as the metadata
    // endpoint it is, and a vouched destination would reach it.
    if (
      IPV4_EMBEDDING_PREFIXES.some((prefix) => prefix.every((part, index) => parts[index] === part))
    ) {
      return embeddedIpv4(parts)
    }

    const embedded = ((parts[6] << 16) >>> 0) + parts[7]
    // `::` and `::1` are the unspecified and loopback addresses, not an IPv4
    // carried inside IPv6 — folding them would turn `::1` into `0.0.0.1` and
    // stop an operator's `::1/128` entry matching it.
    if (parts.slice(0, 6).every((part) => part === 0) && embedded > 1) {
      return embeddedIpv4(parts)
    }
  }
  return parsed.toString()
}

const CANONICAL_METADATA_ADDRESSES: ReadonlySet<string> = new Set(
  METADATA_ADDRESSES.map((address) => canonicalAddress(address) ?? address)
)

function isMetadataAddress(address: string): boolean {
  const canonical = canonicalAddress(address)
  return canonical !== null && CANONICAL_METADATA_ADDRESSES.has(canonical)
}

/**
 * Whether the address sits in the RFC 8215 local-use NAT64 prefix, where the
 * embedded IPv4 destination sits at an offset chosen by the network operator
 * and so cannot be read off the address.
 */
function hidesItsIpv4Destination(address: string): boolean {
  const clean = unwrapIpv6Brackets(address)
  if (!ipaddr.isValid(clean)) return false
  const parsed = ipaddr.process(clean)
  if (parsed.kind() !== 'ipv6') return false
  const { parts } = parsed as ipaddr.IPv6
  return NAT64_LOCAL_USE_PREFIX.every((part, index) => parts[index] === part)
}

/**
 * Whether the destination names itself as loopback — `localhost`, or a loopback
 * IP literal.
 *
 * The loopback carve-out keys off this rather than off the resolved address, so
 * a public hostname that happens to resolve to `127.0.0.1` does not inherit it.
 * Letting the address decide would make every DNS name an attacker controls a
 * route to the deployment's own loopback services.
 */
function isLoopbackDestination(host: string): boolean {
  const clean = unwrapIpv6Brackets(host)
  return isLoopbackHostname(clean) || isLoopbackIp(clean)
}

/**
 * How a destination earned its reachability, or `null` if it has not.
 *
 * The two are not interchangeable. `allowlist` is an operator naming a
 * destination, so it carries their judgement about what is safe there, down to
 * the port. `loopback` is a carve-out this policy grants on its own to any
 * self-hosted deployment, which is why it stops short of exposing the service
 * ports Sim's own datastores listen on.
 */
type Vouch = 'allowlist' | 'loopback' | null

/**
 * How the policy vouches for this destination. A hostname match alone is enough
 * — the operator named that host, so wherever it points is their call.
 * Otherwise the loopback carve-out, the legacy blanket private grant, or a
 * resolved address inside an allowlisted range vouches for it, which is why the
 * last two cannot be decided before DNS for a hostname destination.
 */
function isVouched(url: URL, address: string | undefined, policy: EgressPolicy): Vouch {
  if (matchesHostAllowlist(url.hostname, policy)) return 'allowlist'

  if (policy.allowLoopback && isLoopbackDestination(url.hostname)) {
    // Before DNS there is no address to judge; evaluateAddress rules later.
    if (address === undefined) return 'loopback'
    // The address must land on loopback too, so a resolver answering
    // `localhost` with a routable address cannot borrow the carve-out — but it
    // may still be vouched by an allowlist entry, so this falls through rather
    // than refusing outright.
    if (isLoopbackIp(unwrapIpv6Brackets(address))) return 'loopback'
  }

  if (address === undefined) return null
  if (policy.allowPrivate && isPrivateIp(unwrapIpv6Brackets(address))) return 'allowlist'
  return matchesRangeAllowlist(address, policy) ? 'allowlist' : null
}

function checkSchemeAndPort(url: URL, vouch: Vouch, policy: EgressPolicy): EgressDecision {
  if (
    url.protocol === 'http:' &&
    policy.insecureHttp !== 'always' &&
    !(vouch !== null && policy.insecureHttp === 'whenVouched')
  ) {
    return deny('insecure-scheme', `plain http to ${url.hostname}`)
  }

  // Only an operator naming the destination lifts the port denylist. The
  // loopback carve-out deliberately does not: it is granted without anyone
  // asking for it, and loopback is exactly where Sim's own Postgres and Redis
  // listen, so lifting it there would hand every workflow author a route in.
  if (vouch !== 'allowlist' && url.port) {
    const port = Number.parseInt(url.port, 10)
    if (DENIED_PORTS.has(port)) {
      return deny('port-denied', `port ${port}`)
    }
  }

  return ALLOWED
}

/** Classifies one address, assuming the vouched decision has already been made. */
function checkAddressClass(address: string, vouch: Vouch): EgressDecision {
  if (vouch !== null) return ALLOWED

  const clean = unwrapIpv6Brackets(address)
  if (isLoopbackIp(clean)) {
    return deny('address-loopback', address)
  }
  if (isPrivateIp(clean)) {
    return deny('address-blocked', address)
  }

  return ALLOWED
}

/**
 * Pre-DNS gate. Decides completely when the host is an IP literal; for a
 * hostname it judges the destination as unvouched, since where the name points
 * is not known yet.
 *
 * Neither verdict is the last word on a hostname. A refusal may be liftable once
 * the address is known ({@link policyDefersToAddress},
 * {@link isLiftableByVouching}),
 * and an approval covers only what needs no lookup — {@link evaluateAddress} is
 * authoritative and must run against every resolved address before connecting.
 */
export function evaluateUrl(url: URL, policy: EgressPolicy): EgressDecision {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return deny('scheme-not-permitted', `unsupported protocol ${url.protocol}`)
  }

  const host = unwrapIpv6Brackets(url.hostname)
  if (isIpLiteral(host)) {
    return evaluateAddress(url, host, policy)
  }

  const vouch = isVouched(url, undefined, policy)

  // A name that says it is loopback needs no lookup to be refused. Deciding it
  // here rather than after DNS is what keeps the synchronous validator — the one
  // that checks a value as it is saved — from accepting `https://localhost/x` on
  // a deployment where loopback is Sim's own process.
  if (vouch === null && isLoopbackDestination(host)) {
    return deny('address-loopback', host)
  }

  // Otherwise judged as if unvouched, because a hostname's address is not known
  // yet. A policy that could still vouch for it once resolved must not treat
  // this verdict as final — see {@link policyDefersToAddress}.
  return checkSchemeAndPort(url, vouch, policy)
}

/**
 * Whether a refusal from {@link evaluateUrl} on a hostname could still be
 * reversed by learning the resolved address — an IP-range entry, or the legacy
 * blanket private grant.
 *
 * A DNS-resolving caller uses this to decide whether that refusal is final. It
 * is deliberately narrow: a hostname allowlist entry and the loopback carve-out
 * are both decided from the hostname, so {@link evaluateUrl} has already applied
 * them, and treating those as reasons to resolve would defer every refusal and
 * hand a lookup to a destination the policy has already turned down.
 */
export function policyDefersToAddress(policy: EgressPolicy): boolean {
  return policy.allowedRanges.length > 0 || policy.allowPrivate
}

/**
 * Whether a refusal could be lifted by learning the destination's address.
 * `scheme-not-permitted` and `address-metadata` never can be.
 */
export function isLiftableByVouching(reason: EgressDenyReason): boolean {
  return reason !== 'scheme-not-permitted' && reason !== 'address-metadata'
}

/**
 * Authoritative gate for one resolved address. `url` is the destination the
 * address was resolved for, so a hostname allowlist entry still applies.
 *
 * Call this for every address a host resolves to. A caller that connects to a
 * different address than the one it evaluated has no protection against DNS
 * rebinding, so the evaluated address must also be the pinned one.
 */
export function evaluateAddress(url: URL, address: string, policy: EgressPolicy): EgressDecision {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return deny('scheme-not-permitted', `unsupported protocol ${url.protocol}`)
  }

  // Checked before the allowlist, and before the cheaper scheme/port rules, so
  // that reaching for a metadata endpoint always reports why it is hopeless.
  if (isMetadataAddress(address)) {
    return deny('address-metadata', address)
  }

  // Before any vouching rule: an address that cannot be parsed cannot be
  // classified, and an allowlisted hostname must not carry it past the check.
  if (!isIpLiteral(unwrapIpv6Brackets(address))) {
    return deny('address-blocked', `${address} is not a valid address`)
  }

  // Same reasoning: a local-use NAT64 address names an IPv4 destination this
  // code cannot read, so it is refused rather than judged on the wrapper.
  if (hidesItsIpv4Destination(address)) {
    return deny('address-blocked', `${address} hides its IPv4 destination`)
  }

  const vouch = isVouched(url, address, policy)

  const shape = checkSchemeAndPort(url, vouch, policy)
  if (!shape.allowed) return shape

  return checkAddressClass(address, vouch)
}
