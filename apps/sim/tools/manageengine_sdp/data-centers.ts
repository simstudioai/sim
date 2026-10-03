/**
 * ServiceDesk Plus Cloud API hosts, one per Zoho data center.
 *
 * Verbatim from the "API endpoints by data center" table in
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/getting-started/oauth-2.0.html.
 * Note the apex changes with the region — the US/EU/IN centers live under
 * `sdpondemand.manageengine.*` while every other center lives under its own
 * `servicedeskplus.*` domain, so there is no TLD substitution that derives one
 * from another.
 *
 * Kept as a closed map rather than a user-supplied base URL: the resolved value
 * receives the OAuth access token on every call, so the set of hosts that can
 * ever see that token is fixed at build time and no request-time URL validation
 * (or SSRF guard) is needed.
 *
 * Reachability caveat: a Zoho access token is only valid in the data center that
 * issued it, and Sim's authorize + token-exchange legs are pinned to the US
 * accounts server, so only {@link SDP_DATA_CENTER_BASES.US} is usable with a
 * credential connected through Sim today. The other entries are the documented
 * hosts and become usable once the grant reads the `accounts-server` callback
 * param; they are listed here so that change is a connector fix rather than a
 * rewrite of every tool.
 */
export const SDP_DATA_CENTER_BASES = {
  US: 'https://sdpondemand.manageengine.com',
  EU: 'https://sdpondemand.manageengine.eu',
  IN: 'https://sdpondemand.manageengine.in',
  AU: 'https://servicedeskplus.net.au',
  JP: 'https://servicedeskplus.jp',
  CA: 'https://servicedeskplus.ca',
  SA: 'https://servicedeskplus.sa',
  UK: 'https://servicedeskplus.uk',
  CN: 'https://servicedeskplus.cn',
  AE: 'https://servicedeskplus.ae',
} as const

export type SdpDataCenter = keyof typeof SDP_DATA_CENTER_BASES

/** Data center used when none is selected. */
export const DEFAULT_SDP_DATA_CENTER: SdpDataCenter = 'US'

/**
 * Resolve a data-center code to its API base URL.
 *
 * Unrecognized input falls back to the US base rather than throwing: the code
 * comes from a closed dropdown, so a value outside the map means stale block
 * state (or an LLM-authored tool call), and the US center is where a Zoho
 * account provisioned without a regional choice lives. Matching is
 * case-insensitive because the value round-trips through workflow JSON.
 */
export function resolveSdpBase(dataCenter: string | undefined): string {
  const code = dataCenter?.trim().toUpperCase()
  if (code && code in SDP_DATA_CENTER_BASES) {
    return SDP_DATA_CENTER_BASES[code as SdpDataCenter]
  }
  return SDP_DATA_CENTER_BASES[DEFAULT_SDP_DATA_CENTER]
}
