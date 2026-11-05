import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { provisioningFixture } from '@/platform/fixtures/settings/sso-provisioning'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import type { OrganizationDomain, SsoProviderView } from '@/platform/lib/data/sso'

const ORG_DOMAIN = 'example.com'
const UPDATED = '2026-10-13T11:24:00.000Z'

function domainRecord(domain: string, verified = false): OrganizationDomain {
  return {
    id: generateId(),
    domain,
    status: verified ? 'verified' : 'pending',
    verifiedAt: verified ? UPDATED : null,
    challengeHost: `_sim-challenge.${domain}`,
    txtRecordValue: verified ? null : `sim-verification=${generateId()}`,
  }
}

function exampleProvider(state: SettingsFixtureState, kind: 'oidc' | 'saml'): SsoProviderView {
  const oidc = kind === 'oidc'
  return {
    id: generateId(),
    providerId: oidc ? 'company-okta' : 'company-entra',
    providerType: kind,
    domain: ORG_DOMAIN,
    domainKey: ORG_DOMAIN,
    domainVerified: true,
    isPrimary: oidc,
    userId: state.general.profile.id,
    organizationId: state.organizationId,
    issuer: 'https://identity.example.com',
    oidcConfig: oidc
      ? JSON.stringify({
          clientId: 'sim-enterprise',
          scopes: ['openid', 'profile', 'email'],
          clientSecret: '[REDACTED]',
        })
      : null,
    samlConfig: oidc
      ? null
      : JSON.stringify({
          entryPoint: 'https://identity.example.com/saml',
          cert: 'Example public certificate',
        }),
    jitProvisioningEnabled: true,
  }
}

interface IdentityFixture {
  providers: SsoProviderView[]
  domains: OrganizationDomain[]
  requireSso: boolean
}

const sessions = new WeakMap<SettingsFixtureState, IdentityFixture>()

function session(state: SettingsFixtureState) {
  let data = sessions.get(state)
  if (!data) {
    const full = state.scenario !== 'empty'
    data = {
      providers: full ? [exampleProvider(state, 'oidc'), exampleProvider(state, 'saml')] : [],
      domains: full ? [domainRecord(ORG_DOMAIN, true), domainRecord('research.example.com')] : [],
      requireSso: false,
    }
    sessions.set(state, data)
  }
  return data
}

function registeredProvider(
  data: IdentityFixture,
  body: Record<string, unknown>,
  state: SettingsFixtureState
): SsoProviderView {
  const existing = data.providers.find((item) => item.providerId === body.providerId)
  const domain = String(body.domain)
  const domainKey = domain.trim().toLowerCase().replace(/^\*\./, '')
  const oidc = body.providerType === 'oidc'
  const { clientSecret, ...publicConfig } = body
  const config = JSON.stringify(
    oidc ? { ...publicConfig, clientSecret: '[REDACTED]' } : publicConfig
  )
  return {
    id: existing?.id ?? generateId(),
    providerId: String(body.providerId),
    providerType: oidc ? 'oidc' : 'saml',
    domain,
    domainKey,
    domainVerified: data.domains.some(
      (row) => row.domain === domainKey && row.status === 'verified'
    ),
    isPrimary: existing?.isPrimary ?? !data.providers.some((item) => item.domainKey === domainKey),
    userId: state.general.profile.id,
    organizationId: state.organizationId,
    issuer: String(body.issuer),
    oidcConfig: oidc ? config : null,
    samlConfig: oidc ? null : config,
    jitProvisioningEnabled: body.jitProvisioningEnabled !== false,
  }
}

async function providerAction(
  request: Request,
  path: string,
  data: IdentityFixture,
  state: SettingsFixtureState
) {
  if (path === '/api/auth/sso/providers') return { providers: data.providers }
  if (path === '/api/auth/sso/register') {
    const provider = registeredProvider(data, toRecord(await request.json()), state)
    data.providers = [
      provider,
      ...data.providers.filter((item) => item.providerId !== provider.providerId),
    ]
    return {
      success: true,
      providerId: provider.providerId,
      providerType: provider.providerType,
      message: 'Identity provider saved',
    }
  }
  const provider = data.providers.find(
    (row) => path === `/api/auth/sso/providers/${encodeURIComponent(row.providerId)}`
  )
  if (!provider) return
  if (request.method === 'DELETE') {
    data.providers = data.providers.filter((row) => row !== provider)
    if (provider.isPrimary) {
      const next = data.providers.find((row) => row.domainKey === provider.domainKey)
      if (next) next.isPrimary = true
    }
  } else if (request.method === 'PATCH') {
    for (const row of data.providers)
      if (row.domainKey === provider.domainKey) row.isPrimary = row === provider
  }
  return { success: true, providerId: provider.providerId }
}

export async function ssoFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
): Promise<unknown> {
  const scope = `/api/organizations/${state.organizationId}/`
  const key = path.startsWith(scope) ? path.slice(scope.length) : undefined
  if (key?.startsWith('scim')) return provisioningFixture(request, key, state)
  if (!path.startsWith('/api/auth/sso/') && key !== 'sso-policy' && !key?.startsWith('domains'))
    return
  const data = session(state)
  if (path.startsWith('/api/auth/sso/')) return providerAction(request, path, data, state)
  if (key === 'sso-policy') {
    if (request.method === 'PUT')
      data.requireSso = toRecord(await request.json()).requireSso === true
    const hasVerifiedProvider = data.providers.some((provider) => provider.domainVerified)
    return {
      success: true,
      data: {
        requireSso: data.requireSso,
        hasVerifiedProvider,
        isEnforced: data.requireSso && hasVerifiedProvider,
      },
    }
  }
  if (key === 'domains') {
    if (request.method === 'POST') {
      const domain = domainRecord(
        String(toRecord(await request.json()).domain)
          .trim()
          .toLowerCase()
      )
      if (data.domains.some((item) => item.domain === domain.domain))
        throw new Error('Domain already exists')
      data.domains.push(domain)
      return { success: true, data: { domain } }
    }
    return { success: true, data: { domains: data.domains, isEnterprise: true } }
  }
  const [, id, action] = key?.split('/') ?? []
  const domain = data.domains.find((item) => item.id === id)
  if (!domain) return
  if (action === 'verify') {
    domain.status = 'verified'
    domain.verifiedAt = new Date().toISOString()
    domain.txtRecordValue = null
    for (const provider of data.providers)
      if (provider.domainKey === domain.domain) provider.domainVerified = true
    return { success: true, data: { domain } }
  }
  if (request.method === 'DELETE') {
    data.domains = data.domains.filter((item) => item !== domain)
    for (const provider of data.providers)
      if (provider.domainKey === domain.domain) provider.domainVerified = false
    return { success: true }
  }
}
