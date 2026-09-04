import { isIpLiteral, unwrapIpv6Brackets } from '@sim/security/ssrf'
import type { OAuthService } from '@/lib/oauth/types'

export type OciDestinationProvenance = 'static' | 'authenticated-discovery'

export interface OciRealm {
  readonly id: string
  readonly domain: string
}

export interface OciRegion {
  readonly id: string
  readonly realm: OciRealm
}

declare const preparedOciEndpointBrand: unique symbol

/** An OCI endpoint prepared from a declarative product policy. */
export interface OciPreparedEndpoint {
  readonly origin: string
  readonly hostname: string
  readonly serviceId: OAuthService
  readonly serviceName: string
  readonly region: OciRegion
  readonly provenance: OciDestinationProvenance
  readonly [preparedOciEndpointBrand]: true
}

declare const ociEndpointPolicyBrand: unique symbol

export interface OciStaticEndpointPolicy {
  readonly kind: 'static'
  readonly serviceId: OAuthService
  readonly serviceName: string
  readonly [ociEndpointPolicyBrand]: true
}

export type OciDiscoverySource =
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'json'; readonly path: readonly string[] }

export interface OciDiscoveredEndpointPolicy {
  readonly kind: 'authenticated-discovery'
  readonly serviceId: OAuthService
  readonly serviceName: string
  readonly responsePolicy: OciEndpointPolicy
  readonly source: OciDiscoverySource
  readonly allowRegionalHost: boolean
  readonly [ociEndpointPolicyBrand]: true
}

export type OciEndpointPolicy = OciStaticEndpointPolicy | OciDiscoveredEndpointPolicy

/**
 * Realm and region snapshot copied from `oci-common@2.140.0` files
 * `lib/realm.js` and `lib/region.js`, and verified byte-for-byte against the
 * same registry files in `2.140.1`. Unknown runtime metadata is deliberately
 * excluded so credentials cannot weaken endpoint trust with local OCI config.
 */
const REALM_DOMAINS = {
  oc1: 'oraclecloud.com',
  oc2: 'oraclegovcloud.com',
  oc3: 'oraclegovcloud.com',
  oc4: 'oraclegovcloud.uk',
  oc8: 'oraclecloud8.com',
  oc9: 'oraclecloud9.com',
  oc10: 'oraclecloud10.com',
  oc14: 'oraclecloud14.com',
  oc15: 'oraclecloud15.com',
  oc19: 'oraclecloud.eu',
  oc20: 'oraclecloud20.com',
  oc21: 'oraclecloud21.com',
  oc23: 'oraclecloud23.com',
  oc24: 'oraclecloud24.com',
  oc26: 'oraclecloud26.com',
  oc29: 'oraclecloud29.com',
  oc35: 'oraclecloud35.com',
  oc42: 'oraclecloud42.com',
  oc51: 'oraclecloud51.com',
  oc52: 'oraclecloud52.com',
} as const

type OciRealmId = keyof typeof REALM_DOMAINS

const REGION_REALMS = {
  'ap-chuncheon-1': 'oc1',
  'ap-mumbai-1': 'oc1',
  'ap-hyderabad-1': 'oc1',
  'ap-seoul-1': 'oc1',
  'ap-sydney-1': 'oc1',
  'ap-melbourne-1': 'oc1',
  'ap-osaka-1': 'oc1',
  'ap-tokyo-1': 'oc1',
  'ca-montreal-1': 'oc1',
  'ca-toronto-1': 'oc1',
  'eu-frankfurt-1': 'oc1',
  'eu-zurich-1': 'oc1',
  'sa-saopaulo-1': 'oc1',
  'uk-cardiff-1': 'oc1',
  'uk-london-1': 'oc1',
  'us-ashburn-1': 'oc1',
  'us-phoenix-1': 'oc1',
  'eu-amsterdam-1': 'oc1',
  'me-jeddah-1': 'oc1',
  'us-sanjose-1': 'oc1',
  'me-dubai-1': 'oc1',
  'sa-santiago-1': 'oc1',
  'sa-vinhedo-1': 'oc1',
  'il-jerusalem-1': 'oc1',
  'eu-marseille-1': 'oc1',
  'ap-singapore-1': 'oc1',
  'me-abudhabi-1': 'oc1',
  'eu-milan-1': 'oc1',
  'eu-stockholm-1': 'oc1',
  'af-johannesburg-1': 'oc1',
  'eu-paris-1': 'oc1',
  'mx-queretaro-1': 'oc1',
  'eu-madrid-1': 'oc1',
  'us-chicago-1': 'oc1',
  'mx-monterrey-1': 'oc1',
  'us-saltlake-2': 'oc1',
  'sa-bogota-1': 'oc1',
  'sa-valparaiso-1': 'oc1',
  'ap-singapore-2': 'oc1',
  'me-riyadh-1': 'oc1',
  'ap-delhi-1': 'oc1',
  'ap-batam-1': 'oc1',
  'eu-madrid-3': 'oc1',
  'eu-turin-1': 'oc1',
  'ap-kulai-2': 'oc1',
  'af-casablanca-1': 'oc1',
  'us-langley-1': 'oc2',
  'us-luke-1': 'oc2',
  'us-gov-ashburn-1': 'oc3',
  'us-gov-chicago-1': 'oc3',
  'us-gov-phoenix-1': 'oc3',
  'uk-gov-london-1': 'oc4',
  'uk-gov-cardiff-1': 'oc4',
  'ap-chiyoda-1': 'oc8',
  'ap-ibaraki-1': 'oc8',
  'me-dcc-muscat-1': 'oc9',
  'me-ibri-1': 'oc9',
  'ap-dcc-canberra-1': 'oc10',
  'eu-dcc-milan-1': 'oc14',
  'eu-dcc-milan-2': 'oc14',
  'eu-dcc-dublin-2': 'oc14',
  'eu-dcc-rating-2': 'oc14',
  'eu-dcc-rating-1': 'oc14',
  'eu-dcc-dublin-1': 'oc14',
  'ap-dcc-gazipur-1': 'oc15',
  'eu-madrid-2': 'oc19',
  'eu-frankfurt-2': 'oc19',
  'eu-jovanovac-1': 'oc20',
  'me-dcc-doha-1': 'oc21',
  'me-alrayyan-1': 'oc21',
  'us-somerset-1': 'oc23',
  'us-thames-1': 'oc23',
  'eu-dcc-zurich-1': 'oc24',
  'eu-crissier-1': 'oc24',
  'me-abudhabi-3': 'oc26',
  'me-alain-1': 'oc26',
  'me-abudhabi-2': 'oc29',
  'me-abudhabi-4': 'oc29',
  'ap-seoul-2': 'oc35',
  'ap-suwon-1': 'oc35',
  'ap-chuncheon-2': 'oc35',
  'us-ashburn-2': 'oc42',
  'us-newark-1': 'oc42',
  'eu-budapest-1': 'oc51',
  'sa-riodejaneiro-1': 'oc52',
} as const satisfies Record<string, OciRealmId>

export const OCI_REGION_IDS = Object.freeze(Object.keys(REGION_REALMS))

function normalizeRegionId(regionId: string): string {
  return regionId.trim().toLowerCase()
}

export function getOciRegion(regionId: string): OciRegion {
  const normalized = normalizeRegionId(regionId)
  const realmId = Object.hasOwn(REGION_REALMS, normalized)
    ? REGION_REALMS[normalized as keyof typeof REGION_REALMS]
    : undefined
  if (!realmId) throw new Error('OCI region is not recognized')
  return {
    id: normalized,
    realm: { id: realmId, domain: REALM_DOMAINS[realmId] },
  }
}

export function resolveEffectiveOciRegion(defaultRegion: string, override?: string): OciRegion {
  const configured = getOciRegion(defaultRegion)
  const effective = override === undefined ? configured : getOciRegion(override)
  if (configured.realm.id !== effective.realm.id) {
    throw new Error('OCI region override must remain in the credential realm')
  }
  return effective
}

function assertServiceName(value: string): void {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(value)) {
    throw new Error('OCI endpoint policy service name is invalid')
  }
}

function assertDiscoverySource(source: OciDiscoverySource): void {
  if (source.kind === 'header') {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(source.name)) {
      throw new Error('OCI discovery header name is invalid')
    }
    return
  }
  if (
    source.kind !== 'json' ||
    source.path.length === 0 ||
    source.path.length > 8 ||
    source.path.some(
      (segment) =>
        segment.length === 0 || segment.length > 128 || /[\u0000-\u001f\u007f]/.test(segment)
    )
  ) {
    throw new Error('OCI discovery JSON path is invalid')
  }
}

/** Creates a frozen exact regional-host policy owned by one registered service. */
export function createOciStaticEndpointPolicy(params: {
  serviceId: OAuthService
  serviceName: string
}): OciStaticEndpointPolicy {
  assertServiceName(params.serviceName)
  return Object.freeze({
    kind: 'static',
    serviceId: params.serviceId,
    serviceName: params.serviceName,
  }) as OciStaticEndpointPolicy
}

/** Creates a frozen authenticated-discovery policy without executable hostname callbacks. */
export function createOciDiscoveredEndpointPolicy(params: {
  serviceId: OAuthService
  serviceName: string
  responsePolicy: OciEndpointPolicy
  source: OciDiscoverySource
  allowRegionalHost?: boolean
}): OciDiscoveredEndpointPolicy {
  assertServiceName(params.serviceName)
  assertDiscoverySource(params.source)
  if (params.responsePolicy.serviceId !== params.serviceId) {
    throw new Error('OCI discovery source policy must have the same owning service')
  }
  const source =
    params.source.kind === 'json'
      ? Object.freeze({ ...params.source, path: Object.freeze([...params.source.path]) })
      : Object.freeze({ ...params.source, name: params.source.name.toLowerCase() })
  return Object.freeze({
    kind: 'authenticated-discovery',
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    responsePolicy: params.responsePolicy,
    source,
    allowRegionalHost: params.allowRegionalHost ?? false,
  }) as OciDiscoveredEndpointPolicy
}

export function regionalOciHostname(serviceName: string, region: OciRegion): string {
  assertServiceName(serviceName)
  return `${serviceName}.${region.id}.${region.realm.domain}`
}

function validateOciOrigin(params: {
  origin: string
  policy: OciEndpointPolicy
  region: OciRegion
  provenance: OciDestinationProvenance
}): OciPreparedEndpoint {
  const knownRegion = getOciRegion(params.region.id)
  if (
    knownRegion.realm.id !== params.region.realm.id ||
    knownRegion.realm.domain !== params.region.realm.domain
  ) {
    throw new Error('OCI destination region and realm must match the known registry')
  }
  let url: URL
  try {
    url = new URL(params.origin)
  } catch {
    throw new Error('OCI destination must be a valid HTTPS origin')
  }
  if (
    params.policy.kind !== params.provenance ||
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    isIpLiteral(unwrapIpv6Brackets(url.hostname)) ||
    url.origin !== params.origin
  ) {
    throw new Error('OCI destination must be an exact HTTPS origin with the default port')
  }
  const regionalHostname = regionalOciHostname(params.policy.serviceName, knownRegion)
  const hostnameMatches =
    params.provenance === 'static'
      ? url.hostname === regionalHostname
      : url.hostname.endsWith(`.${regionalHostname}`) ||
        (params.policy.kind === 'authenticated-discovery' &&
          params.policy.allowRegionalHost &&
          url.hostname === regionalHostname)
  if (!hostnameMatches) {
    throw new Error('OCI destination hostname is not owned by the requested service')
  }
  return {
    origin: url.origin,
    hostname: url.hostname,
    serviceId: params.policy.serviceId,
    serviceName: params.policy.serviceName,
    region: knownRegion,
    provenance: params.provenance,
  } as OciPreparedEndpoint
}

/** Resolves a static policy exclusively from its service and validated region. */
export function resolveStaticOciEndpoint(
  policy: OciStaticEndpointPolicy,
  region: OciRegion
): OciPreparedEndpoint {
  const hostname = regionalOciHostname(policy.serviceName, region)
  return validateOciOrigin({
    origin: `https://${hostname}`,
    policy,
    region,
    provenance: 'static',
  })
}

/** Structurally validates an origin extracted from an authenticated response. */
export function resolveDiscoveredOciEndpoint(
  policy: OciDiscoveredEndpointPolicy,
  region: OciRegion,
  origin: string
): OciPreparedEndpoint {
  return validateOciOrigin({
    origin,
    policy,
    region,
    provenance: 'authenticated-discovery',
  })
}
