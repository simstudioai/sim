import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  getWorkloadIdentityDiscoveryDocument,
  getWorkloadIdentityJwks,
  isWorkloadIdentityConfigured,
} from '@/lib/credentials/workload-identity/issuer'

const logger = createLogger('WorkloadIdentityDiscovery')

/**
 * Cloud providers fetch these anonymously (AWS STS, Databricks) and
 * cache them; five minutes keeps a key rotation visible quickly. "No issuer
 * here" is a 404 rather than an empty document, so a self-hosted deployment
 * without a signing key never advertises one.
 */
const DISCOVERY_HEADERS = {
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
} as const

function notConfigured() {
  return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

/** The issuer's OpenID discovery document, or 404 when this deployment has no usable signing key. */
export async function workloadIdentityDiscoveryResponse() {
  if (!(await isWorkloadIdentityConfigured())) return notConfigured()
  return NextResponse.json(getWorkloadIdentityDiscoveryDocument(), { headers: DISCOVERY_HEADERS })
}

/** The issuer's public signing keys (JWKS), or 404 when this deployment has no usable signing key. */
export async function workloadIdentityJwksResponse() {
  const jwks = await getWorkloadIdentityJwks().catch((error: unknown) => {
    // Still a 404 to the provider, but a broken signing key must not look like an unconfigured one.
    logger.warn('Could not build the workload identity JWKS', { error })
    return null
  })
  if (!jwks) return notConfigured()
  return NextResponse.json(jwks, { headers: DISCOVERY_HEADERS })
}
