import { NextResponse } from 'next/server'
import {
  getWorkloadIdentityDiscoveryDocument,
  getWorkloadIdentityJwks,
  isWorkloadIdentityConfigured,
} from '@/lib/credentials/workload-identity/issuer'

/**
 * Cloud providers fetch these anonymously (AWS STS, Azure AD, Databricks) and
 * cache them; five minutes keeps a key rotation visible quickly. "No issuer
 * here" is a 404 rather than an empty document, so a self-hosted deployment
 * without a signing key never advertises one.
 */
const DISCOVERY_HEADERS = {
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
} as const

function notConfigured() {
  return new NextResponse(null, { status: 404 })
}

export async function workloadIdentityDiscoveryResponse() {
  if (!(await isWorkloadIdentityConfigured())) return notConfigured()
  return NextResponse.json(getWorkloadIdentityDiscoveryDocument(), { headers: DISCOVERY_HEADERS })
}

export async function workloadIdentityJwksResponse() {
  const jwks = await getWorkloadIdentityJwks().catch(() => null)
  if (!jwks) return notConfigured()
  return NextResponse.json(jwks, { headers: DISCOVERY_HEADERS })
}
