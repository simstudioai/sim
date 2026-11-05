import { isRecordLike } from '@sim/utils/object'
import type { SsoProviderView, SsoRegistrationBody } from '@/lib/api/contracts/auth'
import type { OrganizationSsoPolicy } from '@/lib/api/contracts/organization'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'

/** Claim names each protocol uses out of the box; shown as input placeholders. */
export const OIDC_DEFAULT_MAPPING = {
  id: 'sub',
  email: 'email',
  name: 'name',
  image: 'picture',
} as const
export const SAML_DEFAULT_MAPPING = {
  id: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
} as const

export const SAML_NAMEID_FORMATS = [
  { label: 'Provider default', value: '' },
  {
    label: 'Email address',
    value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  },
  { label: 'Persistent', value: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' },
  { label: 'Transient', value: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' },
  { label: 'Unspecified', value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified' },
] as const

/** Fixed width, so the mask never leaks how long the stored secret is. */
const CLIENT_SECRET_MASK = '••••••••••••'

/** A saved secret as the form shows it: the mask, plus the hint when the API judged one safe. */
export function maskedClientSecret(storedHint: string | null): string {
  return storedHint ? `${CLIENT_SECRET_MASK}${storedHint}` : CLIENT_SECRET_MASK
}

/** Reads a string from stored provider JSON, tolerating malformed legacy configurations. */
export function readProviderConfigString(
  serialized: string | null | undefined,
  field: string
): string | null {
  if (!serialized) return null
  try {
    const config: unknown = JSON.parse(serialized)
    return isRecordLike(config) && typeof config[field] === 'string' ? config[field] : null
  } catch {
    return null
  }
}

export const DEFAULT_SSO_FORM = {
  providerType: 'oidc' as 'oidc' | 'saml',
  providerId: '',
  issuerUrl: '',
  domain: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid,profile,email',
  entryPoint: '',
  cert: '',
  callbackUrl: '',
  audience: '',
  wantAssertionsSigned: true,
  idpMetadata: '',
  mapId: '',
  mapEmail: '',
  mapName: '',
  identifierFormat: '',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  jwksEndpoint: '',
  jitProvisioningEnabled: true,
}

export type SsoProviderForm = typeof DEFAULT_SSO_FORM

function validateProviderId(value: string): string[] {
  if (!value || !value.trim()) return ['Provider ID is required.']
  if (!/^[-a-z0-9]+$/i.test(value.trim())) return ['Use letters, numbers, and dashes only.']
  return []
}

function validateIssuerUrl(value: string): string[] {
  const out: string[] = []
  if (!value || !value.trim()) return ['Issuer URL is required.']
  try {
    const url = new URL(value.trim())
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !isLocalhost) {
      out.push('Issuer URL must use HTTPS.')
    }
  } catch {
    out.push('Enter a valid issuer URL like https://your-identity-provider.com/oauth2/default')
  }
  return out
}

function validateDomain(value: string): string[] {
  const out: string[] = []
  if (!value || !value.trim()) return ['Domain is required.']
  if (/^https?:\/\//i.test(value.trim())) out.push('Do not include protocol (https://).')
  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.trim()))
    out.push('Enter a valid domain like company.com')
  return out
}

function validateRequired(label: string, value: string): string[] {
  const out: string[] = []
  if (!value || !value.trim()) out.push(`${label} is required.`)
  return out
}

export interface SsoSecretMode {
  /** Editing an OIDC provider: a secret is stored and the API returned only its sentinel. */
  hasStoredClientSecret: boolean
  isReplacingClientSecret: boolean
}

export function validateSsoProviderForm(
  data: SsoProviderForm,
  { hasStoredClientSecret, isReplacingClientSecret }: SsoSecretMode
) {
  const errors: Record<
    | 'providerType'
    | 'providerId'
    | 'issuerUrl'
    | 'domain'
    | 'clientId'
    | 'clientSecret'
    | 'entryPoint'
    | 'cert'
    | 'scopes'
    | 'callbackUrl'
    | 'audience',
    string[]
  > = {
    providerType: [],
    providerId: validateProviderId(data.providerId),
    issuerUrl: validateIssuerUrl(data.issuerUrl),
    domain: validateDomain(data.domain),
    clientId: [],
    clientSecret: [],
    entryPoint: [],
    cert: [],
    scopes: [],
    callbackUrl: [],
    audience: [],
  }

  const providerType = data.providerType || 'oidc'

  if (providerType === 'oidc') {
    errors.clientId = validateRequired('Client ID', data.clientId)
    /** Skipped only while the stored secret is being kept. Once Replace is clicked the field is a real input again, so a blank or whitespace-only value has to fail rather than quietly overwrite a working secret. */
    errors.clientSecret =
      hasStoredClientSecret && !isReplacingClientSecret
        ? []
        : validateRequired('Client Secret', data.clientSecret)
    if (!data.scopes || !data.scopes.trim()) {
      errors.scopes = ['Scopes are required for OIDC providers']
    }
  } else if (providerType === 'saml') {
    errors.entryPoint = validateIssuerUrl(data.entryPoint || '')
    if (!errors.entryPoint.length && !data.entryPoint) {
      errors.entryPoint = ['Entry Point URL is required for SAML providers']
    }
    errors.cert = validateRequired('Certificate', data.cert)
  }

  return errors
}

export function hasSsoFormErrors(errors: Record<string, string[]>): boolean {
  return Object.values(errors).some((list) => list.length > 0)
}

export function buildSsoRegistrationBody(
  form: SsoProviderForm,
  organizationId: string,
  hasStoredClientSecret: boolean
): SsoRegistrationBody {
  const providerType = form.providerType || 'oidc'
  return providerType === 'oidc'
    ? {
        providerType: 'oidc',
        providerId: form.providerId,
        issuer: form.issuerUrl,
        domain: form.domain,
        orgId: organizationId,
        jitProvisioningEnabled: form.jitProvisioningEnabled,
        mapping: {
          id: form.mapId.trim() || OIDC_DEFAULT_MAPPING.id,
          email: form.mapEmail.trim() || OIDC_DEFAULT_MAPPING.email,
          name: form.mapName.trim() || OIDC_DEFAULT_MAPPING.name,
          image: OIDC_DEFAULT_MAPPING.image,
        },
        clientId: form.clientId,
        /** Blank on an edit means the admin did not retype it: send the sentinel so the server keeps the stored secret. Trimmed because a pasted secret often carries a trailing newline, and because a whitespace-only value must never be stored as the secret. */
        clientSecret:
          hasStoredClientSecret && !form.clientSecret.trim()
            ? REDACTED_MARKER
            : form.clientSecret.trim(),
        scopes: form.scopes.split(',').map((s) => s.trim()),
        ...(form.authorizationEndpoint.trim()
          ? { authorizationEndpoint: form.authorizationEndpoint.trim() }
          : {}),
        ...(form.tokenEndpoint.trim() ? { tokenEndpoint: form.tokenEndpoint.trim() } : {}),
        ...(form.jwksEndpoint.trim() ? { jwksEndpoint: form.jwksEndpoint.trim() } : {}),
      }
    : {
        providerType: 'saml',
        providerId: form.providerId,
        issuer: form.issuerUrl,
        domain: form.domain,
        orgId: organizationId,
        jitProvisioningEnabled: form.jitProvisioningEnabled,
        mapping: {
          id: form.mapId.trim() || SAML_DEFAULT_MAPPING.id,
          email: form.mapEmail.trim() || SAML_DEFAULT_MAPPING.email,
          name: form.mapName.trim() || SAML_DEFAULT_MAPPING.name,
        },
        entryPoint: form.entryPoint,
        cert: form.cert,
        wantAssertionsSigned: form.wantAssertionsSigned,
        ...(form.callbackUrl ? { callbackUrl: form.callbackUrl } : {}),
        ...(form.audience ? { audience: form.audience } : {}),
        ...(form.idpMetadata ? { idpMetadata: form.idpMetadata } : {}),
        identifierFormat: form.identifierFormat,
      }
}

/**
 * The edit form for a stored provider. Throws on a config that does not parse, so the caller reports
 * it instead of opening a blank form over a working provider.
 */
export function ssoFormFromProvider(provider: SsoProviderView): SsoProviderForm {
  let clientId = ''
  let clientSecret = ''
  let scopes = 'openid,profile,email'
  let entryPoint = ''
  let cert = ''
  let callbackUrl = ''
  let audience = ''
  let wantAssertionsSigned = true
  let idpMetadata = ''
  /** Blank means "use the protocol default", so only carry over a stored value that differs — otherwise editing rewrites a default as an explicit override. */
  let mapping: { id?: string; email?: string; name?: string } = {}
  let identifierFormat = ''
  let authorizationEndpoint = ''
  let tokenEndpoint = ''
  let jwksEndpoint = ''

  if (provider.providerType === 'oidc' && provider.oidcConfig) {
    const config = JSON.parse(provider.oidcConfig)
    clientId = config.clientId || ''
    clientSecret = config.clientSecret === REDACTED_MARKER ? '' : config.clientSecret || ''
    scopes = config.scopes?.join(',') || 'openid,profile,email'
    mapping = config.mapping ?? {}
    authorizationEndpoint = config.authorizationEndpoint || ''
    tokenEndpoint = config.tokenEndpoint || ''
    jwksEndpoint = config.jwksEndpoint || ''
  } else if (provider.providerType === 'saml' && provider.samlConfig) {
    const config = JSON.parse(provider.samlConfig)
    entryPoint = config.entryPoint || ''
    cert = config.cert || ''
    callbackUrl = config.callbackUrl || ''
    audience = config.audience || ''
    wantAssertionsSigned = config.wantAssertionsSigned ?? true
    /** Two stored shapes: `{ metadata }` from the route, a bare string from older rows. Narrow on type, not truthiness — `{ metadata: '' }` is falsy at `.metadata` but truthy as an object, putting an object in a string field. */
    idpMetadata =
      typeof config.idpMetadata === 'string'
        ? config.idpMetadata
        : (config.idpMetadata?.metadata ?? '')
    mapping = config.mapping ?? {}
    identifierFormat = config.identifierFormat || ''
  }

  const defaults = provider.providerType === 'saml' ? SAML_DEFAULT_MAPPING : OIDC_DEFAULT_MAPPING
  const overrideOf = (value: string | undefined, fallback: string) =>
    value && value !== fallback ? value : ''

  return {
    providerType: provider.providerType ?? 'oidc',
    providerId: provider.providerId ?? '',
    issuerUrl: provider.issuer ?? '',
    domain: provider.domain ?? '',
    clientId,
    clientSecret,
    scopes,
    entryPoint,
    cert,
    callbackUrl,
    audience,
    wantAssertionsSigned,
    idpMetadata,
    mapId: overrideOf(mapping.id, defaults.id),
    mapEmail: overrideOf(mapping.email, defaults.email),
    mapName: overrideOf(mapping.name, defaults.name),
    identifierFormat,
    authorizationEndpoint,
    tokenEndpoint,
    jwksEndpoint,
    jitProvisioningEnabled: provider.jitProvisioningEnabled ?? true,
  }
}

/** Where the identity provider returns to, while the form is being filled in. */
export function ssoFormCallbackUrl(
  form: SsoProviderForm,
  existing: SsoProviderView | undefined,
  baseUrl: string
): string {
  const isSaml = form.providerType === 'saml'
  return (
    (isSaml && form.callbackUrl) ||
    `${baseUrl}/api/auth/${isSaml ? 'sso/saml2/callback' : 'sso/callback'}/${form.providerId || existing?.providerId || 'provider-id'}`
  )
}

/** Where the identity provider returns to, for a saved provider. */
export function ssoProviderCallbackUrl(provider: SsoProviderView, baseUrl: string): string {
  return (
    (provider.providerType === 'saml' &&
      readProviderConfigString(provider.samlConfig, 'callbackUrl')) ||
    `${baseUrl}/api/auth/${provider.providerType === 'saml' ? 'sso/saml2/callback' : 'sso/callback'}/${provider.providerId}`
  )
}

/**
 * Who signs in the domain once the provider is deleted: the first other verified provider by id when
 * deleting the primary, otherwise the domain's current primary. The list arrives ordered by provider
 * id, so this is the provider the server uses.
 */
export function nextSignInProvider(
  providers: readonly SsoProviderView[],
  deleting: SsoProviderView
): SsoProviderView | undefined {
  return deleting.isPrimary
    ? providers.find(
        (entry) =>
          entry.domainKey === deleting.domainKey &&
          entry.providerId !== deleting.providerId &&
          entry.domainVerified
      )
    : providers.find((entry) => entry.domainKey === deleting.domainKey && entry.isPrimary)
}

export function canMakeProviderPrimary(
  providers: readonly SsoProviderView[],
  provider: SsoProviderView
): boolean {
  return (
    provider.domainVerified === true &&
    !provider.isPrimary &&
    providers.some((entry) => entry.domainKey === provider.domainKey && entry.isPrimary)
  )
}

export const SSO_POLICY_OPTIONS = [
  { value: 'any', label: 'Any method' },
  { value: 'sso-only', label: 'Single sign-on' },
] as const

export function describeSsoPolicy(policy: OrganizationSsoPolicy): string {
  if (policy.requireSso && !policy.isEnforced) {
    return 'Nothing can satisfy the requirement right now, so it is not enforced. Restore an identity provider on a verified domain, or switch back to any method.'
  }
  if (!policy.hasVerifiedProvider) {
    return 'Add an identity provider on a verified domain to require single sign-on.'
  }
  return policy.requireSso
    ? 'Members sign in through your identity provider. Password and email sign-in are refused.'
    : 'Members can sign in with a password, email code, or your identity provider.'
}
