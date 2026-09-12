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
import { isIpLiteral, unwrapIpv6Brackets } from '@sim/security/ssrf'
import { env } from '@/lib/core/config/env'
import {
  getEgressAllowedHosts,
  getEgressAllowedIpRanges,
  isHosted,
  isLegacyPrivateDatabaseAccessAllowed,
} from '@/lib/core/config/env-flags'

/**
 * Where the URL for an outbound request came from.
 *
 * - `configuredEndpoint` — a base or server URL entered during setup, or a
 *   vendor host built in process: GitHub Enterprise, Grafana, a data-drain
 *   destination, a connector's host. Off-hosted, operator-configured Azure model
 *   and OCR hosts are trusted alongside the allowlist. See `selfHostedService` for the on-prem
 *   software that expects plain HTTP.
 * - `requestTarget` — supplied per run by the workflow author: the HTTP block's
 *   `url`, an A2A agent URL, an RSS feed, a Function block's `fetch`.
 * - `contentFetch` — harvested from content, a third-party response, or model
 *   output: an image URL, a file imported by URL, a Slack `url_private`, an
 *   endpoint read out of an OIDC discovery document.
 * - `databaseHost` — a datastore host for a database, cache, or mail connector.
 *   Configured like the first, but without its loopback carve-out: loopback is
 *   exactly where Sim's own database and Redis listen, so reaching them has to
 *   be named rather than assumed.
 * - `selfHostedService` — a configured endpoint for software normally run
 *   on-prem: vLLM, Jupyter, 1Password Connect, ClickHouse, an MCP server. Same
 *   reachability as `configuredEndpoint`, but plain HTTP is expected rather than
 *   conditional, because that is how these are ordinarily served inside a
 *   network. Off-hosted, operator-configured Ollama, vLLM and LiteLLM hosts are
 *   trusted alongside the allowlist. Trust names a host, not a particular port.
 * - `proxy` — the egress proxy itself. Held to the strictest rule of all,
 *   because it is the component that decides where everything else may go: plain
 *   HTTP by protocol, but public destinations only, and no allowlist.
 */
export type EgressProfile =
  | 'configuredEndpoint'
  | 'selfHostedService'
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
  /**
   * When plain HTTP is acceptable for this provenance, off the hosted platform.
   * `always` is capped at `whenVouched` when hosted, where nothing is vouched —
   * software served without TLS is a self-hosted arrangement, and a hosted
   * deployment sending a credential over cleartext to a user-supplied host is
   * not one this taxonomy should permit. {@link ProfileSpec.schemeFixedByProtocol}
   * exempts the one profile whose scheme is not a trust decision.
   */
  readonly insecureHttp: InsecureHttpPolicy
  /**
   * Whether loopback is reachable without being allowlisted, off the hosted
   * platform. True for the profiles whose URLs someone deliberately configured —
   * a single-tenant deployment pointing at its own `localhost` (Ollama, a local
   * Jupyter, a sidecar) is the ordinary case. Never for `contentFetch`, and never
   * on the hosted platform, where `localhost` is Sim's own process.
   *
   * Combined with the posture at build time rather than captured here, so the
   * hosted branch is reachable from a test.
   */
  readonly allowLoopbackOffHosted: boolean
  /**
   * Whether this profile's scheme is fixed by the protocol rather than by how
   * much the destination is trusted. Only `proxy` is: an HTTP proxy is spoken to
   * over HTTP by definition, so the hosted cap below would leave it with no
   * reachable configuration at all.
   */
  readonly schemeFixedByProtocol?: boolean
  /**
   * Whether the deprecated `ALLOW_PRIVATE_DATABASE_HOSTS` applies. Only
   * `databaseHost` sets this, because that is the only thing the flag ever
   * governed.
   */
  readonly honorsLegacyPrivateFlag?: boolean
}

const PROFILE_SPECS: Record<EgressProfile, ProfileSpec> = {
  configuredEndpoint: {
    honorsAllowlist: true,
    insecureHttp: 'whenVouched',
    allowLoopbackOffHosted: true,
  },
  selfHostedService: {
    honorsAllowlist: true,
    insecureHttp: 'always',
    allowLoopbackOffHosted: true,
  },
  // Deliberately identical to `configuredEndpoint` today; kept separate because
  // the provenance differs (a per-run author URL, not setup config) and the two
  // policies may diverge. Do not collapse them.
  requestTarget: {
    honorsAllowlist: true,
    insecureHttp: 'whenVouched',
    allowLoopbackOffHosted: true,
  },
  contentFetch: { honorsAllowlist: false, insecureHttp: 'never', allowLoopbackOffHosted: false },
  databaseHost: {
    honorsAllowlist: true,
    insecureHttp: 'whenVouched',
    allowLoopbackOffHosted: false,
    honorsLegacyPrivateFlag: true,
  },
  proxy: {
    honorsAllowlist: false,
    insecureHttp: 'always',
    allowLoopbackOffHosted: false,
    schemeFixedByProtocol: true,
  },
}

const SOURCE_NAMES = {
  hosts: 'EGRESS_ALLOWED_HOSTS',
  ranges: 'EGRESS_ALLOWED_IP_RANGES',
} as const

interface DeploymentConfig {
  readonly hosts: string | undefined
  readonly ranges: string | undefined
  readonly selfHostedModelUrls: readonly (string | undefined)[]
  readonly configuredModelUrls: readonly (string | undefined)[]
  readonly legacyPrivate: boolean
  readonly hosted: boolean
}

function readDeploymentConfig(): DeploymentConfig {
  return {
    hosts: getEgressAllowedHosts(),
    ranges: getEgressAllowedIpRanges(),
    selfHostedModelUrls: [env.OLLAMA_URL, env.VLLM_BASE_URL, env.LITELLM_BASE_URL],
    configuredModelUrls: [
      env.AZURE_OPENAI_ENDPOINT,
      env.AZURE_ANTHROPIC_ENDPOINT,
      env.OCR_AZURE_ENDPOINT,
    ],
    legacyPrivate: isLegacyPrivateDatabaseAccessAllowed(),
    hosted: isHosted,
  }
}

function buildPolicies(config: DeploymentConfig): Record<EgressProfile, EgressPolicy> {
  return Object.fromEntries(
    (Object.keys(PROFILE_SPECS) as EgressProfile[]).map((profile) => {
      const spec = PROFILE_SPECS[profile]
      // The hosted platform never honors an operator allowlist. `env-flags`
      // already returns empty allowlists when hosted; gating here too keeps the
      // guarantee true even if that source ever regressed — the more critical a
      // property, the more it is worth enforcing in both places.
      const honorsAllowlist = spec.honorsAllowlist && !config.hosted
      const allowedHosts = (config.hosts ?? '').split(',')
      const allowedRanges = (config.ranges ?? '').split(',')
      const modelUrls =
        profile === 'selfHostedService'
          ? config.selfHostedModelUrls
          : profile === 'configuredEndpoint'
            ? config.configuredModelUrls
            : []
      if (honorsAllowlist) {
        for (const endpoint of modelUrls) {
          if (!endpoint) continue
          try {
            const url = new URL(endpoint)
            const host = unwrapIpv6Brackets(url.hostname).replace(/\.$/, '')
            if (
              (url.protocol !== 'http:' && url.protocol !== 'https:') ||
              url.username ||
              url.password ||
              host.includes('*') ||
              host.includes(',')
            ) {
              continue
            }
            if (isIpLiteral(host)) {
              allowedRanges.push(host)
            } else if (
              host &&
              !host.includes(':') &&
              host.split('.').every((label) => label.length > 0)
            ) {
              allowedHosts.push(host)
            }
          } catch {
            /** A malformed model endpoint never grants network access. */
          }
        }
      }

      return [
        profile,
        createEgressPolicy({
          allowedHosts: honorsAllowlist ? allowedHosts : undefined,
          allowedRanges: honorsAllowlist ? allowedRanges : undefined,
          insecureHttp:
            config.hosted && spec.insecureHttp === 'always' && !spec.schemeFixedByProtocol
              ? 'whenVouched'
              : spec.insecureHttp,
          allowLoopback: spec.allowLoopbackOffHosted && !config.hosted,
          allowPrivate: Boolean(spec.honorsLegacyPrivateFlag && config.legacyPrivate),
          sourceNames: SOURCE_NAMES,
        }),
      ]
    })
  ) as Record<EgressProfile, EgressPolicy>
}

function sameConfig(a: DeploymentConfig, b: DeploymentConfig): boolean {
  return (
    a.hosts === b.hosts &&
    a.ranges === b.ranges &&
    a.selfHostedModelUrls.every((url, index) => url === b.selfHostedModelUrls[index]) &&
    a.configuredModelUrls.every((url, index) => url === b.configuredModelUrls[index]) &&
    a.legacyPrivate === b.legacyPrivate &&
    a.hosted === b.hosted
  )
}

/**
 * Policies are cached against the configuration they were built from, so that
 * changing it rebuilds rather than silently serving a stale policy. Caching on
 * the value rather than "built once" is what keeps the configuration reachable
 * from a test without a module-level reset hook.
 */
let cache: { config: DeploymentConfig; policies: Record<EgressProfile, EgressPolicy> } | null = null

/**
 * The policy governing requests of the given provenance on this deployment.
 *
 * An unrecognized profile resolves to the strictest one rather than to
 * `undefined`: the callers are on the request path, and a missing policy there
 * should refuse the destination, not throw somewhere further down where the
 * cause is no longer visible.
 */
export function resolveEgressPolicy(profile: EgressProfile): EgressPolicy {
  const config = readDeploymentConfig()
  if (cache === null || !sameConfig(cache.config, config)) {
    cache = { config, policies: buildPolicies(config) }
  }
  return cache.policies[profile] ?? cache.policies.contentFetch
}

/**
 * Turns a refusal into a message the person who hit it can act on: each reason
 * names the actual blocker and, where one exists, the remedy. A message that
 * only names the scheme is worse than unhelpful, because it implies switching
 * scheme would reach a destination the address check refuses anyway.
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
  const config = readDeploymentConfig()
  // No remedy is offered on the hosted platform, where the allowlist variables
  // are ignored and pointing at them would send the reader somewhere useless.
  const remedy =
    !spec.honorsAllowlist || config.hosted
      ? ''
      : config.hosts || config.ranges
        ? ` It is not covered by ${SOURCE_NAMES.hosts} or ${SOURCE_NAMES.ranges}.`
        : ` Self-hosted deployments can permit specific destinations with ${SOURCE_NAMES.hosts} or ${SOURCE_NAMES.ranges}.`

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
