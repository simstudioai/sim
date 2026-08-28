/**
 * Egress profiles: the deployment's answer to "how far may this kind of request
 * reach?".
 *
 * The taxonomy is **where the URL came from**, because provenance is what
 * determines how much trust a destination has earned. A base URL an operator
 * typed during setup is not the same input as a link harvested from a
 * third-party API response, and treating them identically is what left Sim
 * simultaneously too strict for the first and too loose for the last.
 *
 * This module is the only place deployment posture and operator configuration
 * are read. Everything below it takes an {@link EgressPolicy} value.
 */

import {
  createEgressPolicy,
  type EgressDecision,
  type EgressPolicy,
  type InsecureHttpPolicy,
} from '@sim/security/egress'
import { egressAllowedHosts, egressAllowedIpRanges, isHosted } from '@/lib/core/config/env-flags'

/**
 * Where the URL for an outbound request came from.
 *
 * - `configuredEndpoint` — a base or server URL entered during setup: a
 *   self-hosted vLLM or Jupyter instance, GitHub Enterprise, Grafana,
 *   ClickHouse, an MCP server, a data-drain destination, a connector's host.
 * - `requestTarget` — supplied per run by the workflow author: the HTTP block's
 *   `url`, an A2A agent URL, an RSS feed, a Function block's `fetch`.
 * - `contentFetch` — harvested from content, a third-party response, or model
 *   output: an image URL, a file imported by URL, a Slack `url_private`, an
 *   endpoint read out of an OIDC discovery document.
 * - `databaseHost` — a datastore host for a database, cache, or mail connector.
 *   Configured like the first, but without its loopback carve-out: loopback is
 *   exactly where Sim's own database and Redis listen, so reaching them has to
 *   be named rather than assumed.
 * - `proxy` — the egress proxy itself. Held to the strictest rule of all,
 *   because it is the component that decides where everything else may go: plain
 *   HTTP by protocol, but public destinations only, and no allowlist.
 */
export type EgressProfile =
  | 'configuredEndpoint'
  | 'requestTarget'
  | 'contentFetch'
  | 'databaseHost'
  | 'proxy'

interface ProfileSpec {
  /**
   * Whether this profile consults the operator's private-network allowlist.
   *
   * `contentFetch` never does, and that is the point of the taxonomy: it is the
   * class where SSRF is actually exploited, so it must stay locked even on a
   * deployment whose operator has allowlisted their entire internal range.
   */
  readonly honorsAllowlist: boolean
  /** When plain HTTP is acceptable for this provenance. */
  readonly insecureHttp: InsecureHttpPolicy
  /**
   * Whether loopback is reachable without being allowlisted. True off the hosted
   * platform for the two profiles whose URLs someone deliberately configured —
   * a single-tenant deployment pointing at its own `localhost` (Ollama, a local
   * Jupyter, a sidecar) is the ordinary case. Never true for `contentFetch`, and
   * never true on the hosted platform, where `localhost` is Sim's own process.
   */
  readonly allowLoopback: boolean
}

const PROFILE_SPECS: Record<EgressProfile, ProfileSpec> = {
  configuredEndpoint: {
    honorsAllowlist: true,
    insecureHttp: 'whenVouched',
    allowLoopback: !isHosted,
  },
  requestTarget: { honorsAllowlist: true, insecureHttp: 'whenVouched', allowLoopback: !isHosted },
  contentFetch: { honorsAllowlist: false, insecureHttp: 'never', allowLoopback: false },
  databaseHost: { honorsAllowlist: true, insecureHttp: 'whenVouched', allowLoopback: false },
  proxy: { honorsAllowlist: false, insecureHttp: 'always', allowLoopback: false },
}

const SOURCE_NAMES = {
  hosts: 'EGRESS_ALLOWED_HOSTS',
  ranges: 'EGRESS_ALLOWED_IP_RANGES',
} as const

function buildPolicies(hosts: string | undefined, ranges: string | undefined) {
  return Object.fromEntries(
    (Object.keys(PROFILE_SPECS) as EgressProfile[]).map((profile) => {
      const spec = PROFILE_SPECS[profile]
      return [
        profile,
        createEgressPolicy({
          allowedHosts: spec.honorsAllowlist ? hosts : undefined,
          allowedRanges: spec.honorsAllowlist ? ranges : undefined,
          insecureHttp: spec.insecureHttp,
          allowLoopback: spec.allowLoopback,
          sourceNames: SOURCE_NAMES,
        }),
      ]
    })
  ) as Record<EgressProfile, EgressPolicy>
}

/**
 * Policies are built eagerly so a malformed allowlist entry throws at startup
 * rather than at whichever request first happens to touch it, and cached against
 * the configuration they were built from so that changing it rebuilds rather
 * than silently serving a stale policy. Caching on the value rather than "built
 * once" is what keeps the allowlist reachable from a test without a module-level
 * reset hook.
 */
let cache = {
  hosts: egressAllowedHosts,
  ranges: egressAllowedIpRanges,
  policies: buildPolicies(egressAllowedHosts, egressAllowedIpRanges),
}

/**
 * The policy governing requests of the given provenance on this deployment.
 *
 * An unrecognized profile resolves to the strictest one rather than to
 * `undefined`: the callers are on the request path, and a missing policy there
 * should refuse the destination, not throw somewhere further down where the
 * cause is no longer visible.
 */
export function resolveEgressPolicy(profile: EgressProfile): EgressPolicy {
  if (cache.hosts !== egressAllowedHosts || cache.ranges !== egressAllowedIpRanges) {
    cache = {
      hosts: egressAllowedHosts,
      ranges: egressAllowedIpRanges,
      policies: buildPolicies(egressAllowedHosts, egressAllowedIpRanges),
    }
  }
  return cache.policies[profile] ?? cache.policies.contentFetch
}

/** True when this deployment has any private-network allowlist configured. */
function hasAllowlist(): boolean {
  return Boolean(egressAllowedHosts || egressAllowedIpRanges)
}

/**
 * Turns a refusal into a message the person who hit it can act on.
 *
 * The message this replaced said `url must use https:// protocol`, which was
 * worse than unhelpful: it implied switching scheme would fix a destination that
 * the address check was going to refuse anyway. Each reason here names the
 * actual blocker and, where one exists, the remedy.
 */
export function describeEgressDenial(
  decision: Extract<EgressDecision, { allowed: false }>,
  paramName: string,
  profile: EgressProfile
): string {
  // Mirrors resolveEgressPolicy: an unrecognized profile is described with the
  // strictest spec, so a bad profile can never advertise a remedy that does not
  // apply to the policy that actually refused the request.
  const spec = PROFILE_SPECS[profile] ?? PROFILE_SPECS.contentFetch
  const remedy = spec.honorsAllowlist
    ? hasAllowlist()
      ? ` It is not covered by ${SOURCE_NAMES.hosts} or ${SOURCE_NAMES.ranges}.`
      : ` Self-hosted deployments can permit specific destinations with ${SOURCE_NAMES.hosts} or ${SOURCE_NAMES.ranges}.`
    : ''

  switch (decision.reason) {
    case 'scheme-not-permitted':
      return `${paramName} must use http:// or https:// (got ${decision.detail})`
    case 'insecure-scheme':
      return `${paramName} must use https:// to a public destination.${remedy}`
    case 'port-denied':
      return `${paramName} uses a blocked port (${decision.detail}).${remedy}`
    case 'address-loopback':
      return `${paramName} resolves to loopback (${decision.detail}), which inside a container is the container itself, not the host.${remedy}`
    case 'address-blocked':
      return `${paramName} resolves to a private or reserved address (${decision.detail}).${remedy}`
    case 'address-metadata':
      return `${paramName} resolves to a cloud metadata endpoint (${decision.detail}), which is never reachable and cannot be allowlisted.`
  }
}
