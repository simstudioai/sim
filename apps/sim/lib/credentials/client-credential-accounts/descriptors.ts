/**
 * Client-safe descriptors for client-credentials service-account providers.
 *
 * A client-credential account is a `service_account`-type credential where a
 * workspace admin supplies an OAuth client identity plus a shared secret or
 * signing key and provider account identifier. Unlike the token-paste family
 * (whose stored secret IS the access token), these credentials mint a
 * short-lived access token on demand. This module holds only UI/contract
 * metadata (field lists, labels, docs links); the server-side minting registry
 * lives in `@/lib/credentials/client-credential-accounts/server`.
 */

import { CROWDSTRIKE_CLOUDS } from '@/tools/crowdstrike/types'
import { DATADOG_SITE_LABELS, DATADOG_SITES } from '@/tools/datadog/types'

/** Discriminator stored inside every encrypted client-credential secret blob. */
export const CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE = 'client_credential_account' as const

/** Contract field ids a client-credential connect modal collects. */
export type ClientCredentialAccountFieldId =
  | 'clientId'
  | 'clientSecret'
  | 'certificateId'
  | 'orgId'
  | 'dataCenter'
  | 'scope'
  | 'authMethod'
  | 'privateKey'
  | 'username'
  | 'apiToken'

/**
 * The field id that selects between a descriptor's auth methods. A descriptor
 * declaring it must also set `defaultAuthMethod`, or every branch-specific
 * field resolves to hidden.
 */
export const AUTH_METHOD_FIELD_ID = 'authMethod' as const satisfies ClientCredentialAccountFieldId

export interface ClientCredentialAccountOption {
  value: string
  label: string
}

export interface ClientCredentialAccountField {
  id: ClientCredentialAccountFieldId
  label: string
  placeholder: string
  /** Rendered with SecretInput and never echoed back. */
  secret: boolean
  /** Preserve exact password bytes instead of normalizing surrounding whitespace. */
  preserveWhitespace?: boolean
  /**
   * Renders a multi-line control instead of a single-line one. Required for
   * PEM-encoded material (a private key spans ~28 newline-separated lines and
   * is unreadable — and unverifiable by eye — in a single-line input). A
   * `secret` field that is also `multiline` renders as a plain textarea rather
   * than a masked input; the modal never prefills a secret, so masking would
   * only hide the user's own paste from them.
   */
  multiline?: boolean
  /**
   * Auth methods this field belongs to, for descriptors offering more than one
   * (Salesforce: client credentials vs JWT bearer). The field is hidden, and
   * skipped by validation, unless the selected method appears in this list.
   * Absent means the field belongs to every branch.
   */
  requiredForAuthMethods?: readonly string[]
  /**
   * Field the connect modal may submit empty; excluded from
   * {@link CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS} so create/reconnect
   * validation never demands it. Omitted (default) means required.
   */
  optional?: boolean
  /**
   * Fixed value set, rendered by the connect modal as a dropdown — which removes
   * the need for a format hint on the field. Required on `dataCenter`: the modal
   * renders that field only when it carries options, so a region selector added
   * without them would silently not appear.
   */
  options?: ReadonlyArray<ClientCredentialAccountOption>
  /** Always-visible guidance, for a field whose value is not self-explanatory. */
  hint?: string
  /** Soft-format hint shown while the current value doesn't match `hintPattern`. */
  hintPattern?: RegExp
  hintMessage?: string
  /**
   * Normalizes the raw value before testing `hintPattern`, mirroring the
   * server-side normalization so values the server accepts (e.g. a pasted
   * `https://` URL) don't show a false format hint.
   */
  hintNormalize?: (value: string) => string
}

export interface ClientCredentialAccountDescriptor {
  /** Stable credential `providerId` (`<provider>-service-account`). */
  providerId: string
  /** Human service label used in modal copy and error messages (e.g. "Zoom"). */
  serviceLabel: string
  /**
   * Short vendor-accurate noun for connect-surface labels ("Add {connectNoun}").
   * Uses the vendor's own vocabulary for the credential.
   */
  connectNoun: string
  fields: ClientCredentialAccountField[]
  /**
   * Grant used when no `authMethod` is submitted or stored. Required on any
   * descriptor carrying an `authMethod` field; meaningless without one.
   */
  defaultAuthMethod?: string
  /** Sim setup guide, docked bottom-left of the connect modal. */
  docsUrl: string
  /**
   * Builds the provider's one-time consent URL from the values in the connect
   * modal, for providers whose grant fails with `consent_required` until a user
   * approves the app (DocuSign JWT Grant). `redirectUri` is the Sim origin the
   * modal is open on. Returns `undefined` when the values can't form one.
   */
  consentUrl?: (
    values: Partial<Record<ClientCredentialAccountFieldId, string>>,
    redirectUri: string
  ) => string | undefined
  /**
   * Optional one-line caveat, rendered under the `orgId` field of the connect modal. A descriptor
   * without an `orgId` field puts its guidance in a field `hint` instead.
   */
  helpText?: string
}

export const ZOOM_SERVICE_ACCOUNT_PROVIDER_ID = 'zoom-service-account' as const
export const BOX_SERVICE_ACCOUNT_PROVIDER_ID = 'box-service-account' as const
export const SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID = 'salesforce-service-account' as const
export const ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID = 'zoho-desk-service-account' as const
export const RAMP_SERVICE_ACCOUNT_PROVIDER_ID = 'ramp-service-account' as const
export const VANTA_SERVICE_ACCOUNT_PROVIDER_ID = 'vanta-service-account' as const
export const FIVETRAN_SERVICE_ACCOUNT_PROVIDER_ID = 'fivetran-service-account' as const
export const NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID = 'netsuite-service-account' as const
export const ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID = 'oracle-epm-service-account' as const
export const ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID = 'oracle-fusion-service-account' as const
export const GREENHOUSE_SERVICE_ACCOUNT_PROVIDER_ID = 'greenhouse-service-account' as const
export const JAMA_SERVICE_ACCOUNT_PROVIDER_ID = 'jama-service-account' as const
export const HELPSCOUT_SERVICE_ACCOUNT_PROVIDER_ID = 'helpscout-service-account' as const
export const DOCUSIGN_SERVICE_ACCOUNT_PROVIDER_ID = 'docusign-service-account' as const
export const CROWDSTRIKE_SERVICE_ACCOUNT_PROVIDER_ID = 'crowdstrike-service-account' as const
export const DATADOG_SERVICE_ACCOUNT_PROVIDER_ID = 'datadog-service-account' as const
export const SAILPOINT_SERVICE_ACCOUNT_PROVIDER_ID = 'sailpoint-service-account' as const
export const ZOOMINFO_SERVICE_ACCOUNT_PROVIDER_ID = 'zoominfo-service-account' as const
export const ZENDESK_SERVICE_ACCOUNT_PROVIDER_ID = 'zendesk-service-account' as const

/** Permissions requested when connecting a Manage Vanta application. */
export const VANTA_PERMISSION_OPTIONS = [
  { value: 'vanta-api.all:read', label: 'Read only' },
  { value: 'vanta-api.all:read vanta-api.all:write', label: 'Read and write' },
  {
    value: 'vanta-api.all:read vanta-api.all:write vanta-api.documents:upload',
    label: 'Read, write, and upload documents',
  },
] as const

export type ClientCredentialAccountProviderId =
  | typeof ZOOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BOX_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof RAMP_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof VANTA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof FIVETRAN_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof GREENHOUSE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof HELPSCOUT_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof JAMA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DOCUSIGN_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CROWDSTRIKE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DATADOG_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SAILPOINT_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ZOOMINFO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ZENDESK_SERVICE_ACCOUNT_PROVIDER_ID

/**
 * Exact account-specific SuiteTalk origin accepted by NetSuite's OAuth and
 * REST endpoints. The account label may include a sandbox suffix such as
 * `-sb1`; paths, ports, credentials, query strings, and fragments are never
 * accepted because the stored origin later receives a bearer token.
 */
export const NETSUITE_SUITETALK_ORIGIN_REGEX =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.suitetalk\.api\.netsuite\.com$/

/**
 * Normalizes an account-specific SuiteTalk URL to its HTTPS origin. Returns
 * `undefined` rather than throwing so the client-side format hint and the
 * server-side minter can share the exact same admission rule.
 */
export function normalizeNetSuiteSuiteTalkOrigin(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl.trim())
    if (
      parsed.protocol !== 'https:' ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      !NETSUITE_SUITETALK_ORIGIN_REGEX.test(parsed.origin)
    ) {
      return undefined
    }
    return parsed.origin
  } catch {
    return undefined
  }
}

/** Canonical Oracle-assigned Fusion Applications origin used by product REST APIs. */
const ORACLE_FUSION_APPLICATION_ORIGIN_REGEX =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.fa\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.oraclecloud\.com$/
const ORACLE_FUSION_APPLICATION_INPUT_REGEX =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.fa\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.oraclecloud\.com\/?$/i

/**
 * Normalizes a Fusion Applications URL to its authoritative HTTPS origin.
 * Explicit ports are rejected even when they match HTTPS's default port so a
 * saved credential can never silently broaden the accepted endpoint shape.
 */
export function normalizeOracleFusionApplicationOrigin(rawUrl: string): string | undefined {
  try {
    const trimmed = rawUrl.trim()
    if (!ORACLE_FUSION_APPLICATION_INPUT_REGEX.test(trimmed)) return undefined
    const parsed = new URL(trimmed)
    if (
      parsed.protocol !== 'https:' ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      !ORACLE_FUSION_APPLICATION_ORIGIN_REGEX.test(parsed.origin)
    ) {
      return undefined
    }
    return parsed.origin
  } catch {
    return undefined
  }
}

/**
 * Allowed My Domain host shapes: one org label (optionally with a
 * `--sandboxName` suffix), an optional partition label (sandbox, develop,
 * scratch, demo, patch, trailblaze, free), then `my.salesforce.com`. Covers
 * production (`org.my.salesforce.com`), sandboxes
 * (`org--sbx.sandbox.my.salesforce.com`), and Developer Edition
 * (`org-dev-ed.develop.my.salesforce.com`). Gov/mil TLDs are excluded.
 */
export const SALESFORCE_MY_DOMAIN_HOST_REGEX =
  /^[a-z0-9][a-z0-9-]*(--[a-z0-9]+)?(\.(sandbox|develop|scratch|demo|patch|trailblaze|free))?\.my\.salesforce\.com$/

/**
 * Server-to-server grants a Salesforce integration app can authenticate with.
 * `client_credentials` posts a consumer key + secret; `jwt_bearer` posts an
 * RS256-signed assertion and names the user to run as, so it needs no shared
 * secret at all. This list is the only allowlist — every consumer resolves
 * against it through {@link resolveSalesforceAuthMethod}.
 * @see https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm&type=5
 */
const SALESFORCE_AUTH_METHOD_OPTIONS: ReadonlyArray<ClientCredentialAccountOption> = [
  { value: 'client_credentials', label: 'Client credentials (consumer secret)' },
  { value: 'jwt_bearer', label: 'JWT bearer (private key)' },
]

/**
 * Client-credentials stays the default so credentials created before the JWT
 * branch existed — whose stored blob carries no `authMethod` — keep minting
 * exactly as they did.
 */
export const SALESFORCE_DEFAULT_AUTH_METHOD = 'client_credentials'

/** A Salesforce username is an email-shaped login, not necessarily a real mailbox. */
export const SALESFORCE_USERNAME_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A PEM private key header, in either container `crypto.createPrivateKey`
 * accepts. Catches the common mix-up of pasting `server.crt` (the certificate
 * that belongs in Salesforce) instead of `server.key`, which would otherwise
 * only surface as an opaque failed mint.
 */
export const SALESFORCE_PRIVATE_KEY_REGEX = /-----BEGIN (RSA )?PRIVATE KEY-----/

/**
 * Normalizes a pasted My Domain value to a bare host: strips the protocol,
 * any path/query/fragment, and trailing content, then lowercases. Shared by
 * the connect modal's format hint and the server-side minter so both judge
 * the same normalized value.
 */
export function normalizeSalesforceMyDomainHost(rawHost: string): string {
  return rawHost
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase()
}

/**
 * Zoho's `soid` token parameter is documented only as the syntax
 * `{servicename}.{zsoid}` with a single Zoho CRM example
 * (`ZohoCRM.600*****434`). Two things are NOT confirmed by Zoho's own docs:
 *
 * 1. that the Desk service name is literally `ZohoDesk` (inferred from the
 *    documented syntax and corroborated only by community posts), and
 * 2. that `zsoid` is the same value as the Desk `orgId` sent in the `orgId`
 *    request header, rather than a distinct Zoho ServiceOrg id.
 *
 * Both need live verification against a real Zoho Desk org before this flow is
 * relied on. The normalization is therefore deliberately permissive: a value
 * that already carries a `{servicename}.` prefix (any dot) is passed through
 * untouched, so an operator who learns the correct prefix or id can paste the
 * full `soid` and bypass the inference entirely. A bare id is prefixed with
 * `ZohoDesk.`.
 *
 * Shared by the connect modal's format hint and the server-side minter so both
 * judge the same normalized value.
 */
export function normalizeZohoDeskSoid(rawOrgId: string): string {
  const trimmed = rawOrgId.trim()
  if (!trimmed || trimmed.includes('.')) return trimmed
  return `ZohoDesk.${trimmed}`
}

/** A normalized `soid`: a service-name prefix plus a numeric Zoho org id. */
export const ZOHO_DESK_SOID_REGEX = /^[A-Za-z]+\.\d+$/

/**
 * Zoho data centers the Self Client (client-credentials) flow supports. Each
 * entry pairs the accounts server that mints the token with the Desk REST host
 * in the same region, so the minter never has to guess either one.
 *
 * Only regions where BOTH hosts are confirmed are listed. CA, SA, JP, CN, and
 * UK are deliberately absent: Zoho's accounts documentation and Zoho's own Desk
 * SDK disagree on Canada (`accounts.zohocloud.ca` vs `accounts.zoho.ca`), and
 * the Desk hosts for the others are not confirmed. More regions can be added
 * once both the accounts server and the Desk host are confirmed for them.
 *
 * This applies to the service account only — the interactive OAuth flow's
 * authorize/token URLs are static per provider and remain US-only.
 */
export const ZOHO_DESK_DATA_CENTERS = {
  us: { accountsBase: 'https://accounts.zoho.com', deskBase: 'https://desk.zoho.com' },
  eu: { accountsBase: 'https://accounts.zoho.eu', deskBase: 'https://desk.zoho.eu' },
  in: { accountsBase: 'https://accounts.zoho.in', deskBase: 'https://desk.zoho.in' },
  au: { accountsBase: 'https://accounts.zoho.com.au', deskBase: 'https://desk.zoho.com.au' },
} as const satisfies Record<string, { accountsBase: string; deskBase: string }>

export type ZohoDeskDataCenterId = keyof typeof ZOHO_DESK_DATA_CENTERS

/** Region used when the admin leaves the field blank, so existing credentials are unaffected. */
export const DEFAULT_ZOHO_DESK_DATA_CENTER: ZohoDeskDataCenterId = 'us'

export const ZOHO_DESK_DATA_CENTER_IDS = Object.keys(
  ZOHO_DESK_DATA_CENTERS
) as ZohoDeskDataCenterId[]

/** Region names, paired with the ids so a label can never name the wrong host. */
const ZOHO_DESK_DATA_CENTER_LABELS: Record<ZohoDeskDataCenterId, string> = {
  us: 'United States',
  eu: 'Europe',
  in: 'India',
  au: 'Australia',
}

/**
 * Connect-modal dropdown options, derived from {@link ZOHO_DESK_DATA_CENTERS} so
 * adding a region cannot leave the picker behind. Each label carries the accounts
 * host the region mints against, which is what an admin recognizes from the URL
 * they sign in to Zoho with.
 */
export const ZOHO_DESK_DATA_CENTER_OPTIONS: ReadonlyArray<ClientCredentialAccountOption> =
  ZOHO_DESK_DATA_CENTER_IDS.map((id) => ({
    value: id,
    label: `${ZOHO_DESK_DATA_CENTER_LABELS[id]} (${ZOHO_DESK_DATA_CENTERS[id].accountsBase.replace('https://', '')})`,
  }))

/** Accepts exactly the supported region codes, case-insensitively after normalization. */
export const ZOHO_DESK_DATA_CENTER_REGEX = new RegExp(`^(${ZOHO_DESK_DATA_CENTER_IDS.join('|')})$`)

/**
 * Normalizes a pasted data-center value to its lowercase region code. Shared by
 * the connect modal's format hint and the server-side minter so both judge the
 * same normalized value.
 */
export function normalizeZohoDeskDataCenter(rawDataCenter: string): string {
  return rawDataCenter.trim().toLowerCase()
}

/**
 * Resolves a stored data-center value to its accounts/Desk host pair. A blank,
 * absent, or unrecognized value falls back to {@link DEFAULT_ZOHO_DESK_DATA_CENTER}
 * so credentials created before this field existed keep minting against the US
 * accounts server exactly as they did.
 */
export function resolveZohoDeskDataCenter(rawDataCenter?: string): {
  id: ZohoDeskDataCenterId
  accountsBase: string
  deskBase: string
} {
  const normalized = normalizeZohoDeskDataCenter(rawDataCenter ?? '')
  const id: ZohoDeskDataCenterId = Object.hasOwn(ZOHO_DESK_DATA_CENTERS, normalized)
    ? (normalized as ZohoDeskDataCenterId)
    : DEFAULT_ZOHO_DESK_DATA_CENTER
  return { id, ...ZOHO_DESK_DATA_CENTERS[id] }
}

/**
 * A SailPoint Identity Security Cloud API host: one tenant label under `api.identitynow.com`, or
 * under `api.identitynowgov.com` for government tenants. Stricter than the legacy block's inline
 * tenant, which also admits a dotted prefix under either domain.
 */
const SAILPOINT_API_HOST_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.api\.identitynow(?:gov)?\.com$/

const SAILPOINT_TENANT_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SAILPOINT_UI_HOST_REGEX = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.identitynow\.com$/
/** `api.identitynow.com` is SailPoint's API domain itself, so `api` never names a tenant. */
const SAILPOINT_API_DOMAIN_AS_TENANT = 'api.api.identitynow.com'

/**
 * Normalizes a SailPoint tenant name, API host, UI host, or https URL of either
 * to the tenant's API host (`{tenant}.api.identitynow.com`, or the same under
 * `api.identitynowgov.com` for a government tenant) for API calls and token
 * requests. Returns `undefined`
 * for anything else (other domains, credentials, ports, more than one tenant
 * label, or `api`, SailPoint's own API domain) rather than throwing, so the
 * connect modal's format hint and the minter share one admission rule.
 * @see https://developer.sailpoint.com/docs/api/authentication
 */
export function normalizeSailPointTenantHost(rawTenant: string): string | undefined {
  const host = toSailPointApiHost(rawTenant.trim().toLowerCase())
  return host === SAILPOINT_API_DOMAIN_AS_TENANT ? undefined : host
}

function toSailPointApiHost(tenant: string): string | undefined {
  if (!tenant) return undefined
  if (SAILPOINT_TENANT_LABEL_REGEX.test(tenant)) return `${tenant}.api.identitynow.com`
  let parsed: URL
  try {
    parsed = new URL(tenant.includes('://') ? tenant : `https://${tenant}`)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return undefined
  }
  if (SAILPOINT_API_HOST_REGEX.test(parsed.hostname)) return parsed.hostname
  const uiHost = SAILPOINT_UI_HOST_REGEX.exec(parsed.hostname)
  return uiHost ? `${uiHost[1]}.api.identitynow.com` : undefined
}

/**
 * DocuSign's two account systems. Each environment has its own authentication
 * service and its own eSignature REST hosts, and a token from one is never
 * accepted by the other, so the credential stores which one it belongs to and
 * nothing a caller types can change it.
 * @see https://developers.docusign.com/platform/auth/jwt/jwt-get-token/
 */
export const DOCUSIGN_ENVIRONMENTS = {
  demo: { authHost: 'account-d.docusign.com', label: 'Developer (demo)' },
  production: { authHost: 'account.docusign.com', label: 'Production' },
} as const satisfies Record<string, { authHost: string; label: string }>

export type DocuSignEnvironment = keyof typeof DOCUSIGN_ENVIRONMENTS

/** Resolves a stored environment value, or `undefined` when it is not exactly one of the two. */
export function resolveDocuSignEnvironment(
  value: string | undefined
): DocuSignEnvironment | undefined {
  const trimmed = value?.trim()
  return trimmed && Object.hasOwn(DOCUSIGN_ENVIRONMENTS, trimmed)
    ? (trimmed as DocuSignEnvironment)
    : undefined
}

/** DocuSign integration keys, user IDs, and account IDs are all GUIDs. */
export const DOCUSIGN_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An unencrypted PEM RSA private key, in the PKCS#1 form DocuSign generates or PKCS#8. */
const DOCUSIGN_PRIVATE_KEY_REGEX =
  /^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----$/

/** Scopes a JWT Grant credential requests; `impersonation` is what JWT consent covers. */
export const DOCUSIGN_JWT_SCOPES = 'signature impersonation'

/**
 * The one-time consent URL the impersonated user opens to let the integration
 * key act as them. DocuSign requires a `redirect_uri` registered on the key;
 * the JWT flow ignores the `code` it receives.
 * @see https://developers.docusign.com/platform/auth/jwt/jwt-get-token/
 */
function buildDocuSignConsentUrl(
  integrationKey: string,
  environment: string | undefined,
  redirectUri: string
): string | undefined {
  const resolved = resolveDocuSignEnvironment(environment)
  const key = integrationKey.trim()
  if (!resolved || !DOCUSIGN_GUID_REGEX.test(key)) return undefined
  const params = new URLSearchParams({
    response_type: 'code',
    scope: DOCUSIGN_JWT_SCOPES,
    client_id: key,
    redirect_uri: redirectUri,
  })
  return `https://${DOCUSIGN_ENVIRONMENTS[resolved].authHost}/oauth/auth?${params.toString()}`
}

/** A Zendesk account subdomain: the `{subdomain}` in `{subdomain}.zendesk.com`. */
export const ZENDESK_SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*$/

/**
 * Normalizes a pasted Zendesk subdomain, accepting the full `https://acme.zendesk.com` URL as
 * well as the bare `acme`. Shared by the connect modal's format hint and the server-side minter
 * so both judge the same value; the minter refuses anything that does not then match
 * {@link ZENDESK_SUBDOMAIN_REGEX}.
 */
export function normalizeZendeskSubdomain(rawSubdomain: string): string {
  return rawSubdomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.zendesk\.com$/, '')
}

/** Zendesk's two server-to-server sign-ins: an OAuth client's client-credentials grant, or an API token. */
export const ZENDESK_AUTH_METHODS = {
  clientCredentials: 'client_credentials',
  apiToken: 'api_token',
} as const

/** Permissions a Zendesk client-credentials token requests. */
const ZENDESK_SCOPE_OPTIONS: ReadonlyArray<ClientCredentialAccountOption> = [
  { value: 'read', label: 'Read only' },
  { value: 'read write', label: 'Read and write' },
]

export const ZENDESK_SCOPES: ReadonlySet<string> = new Set(
  ZENDESK_SCOPE_OPTIONS.map((option) => option.value)
)

export const CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS: Record<
  ClientCredentialAccountProviderId,
  ClientCredentialAccountDescriptor
> = {
  [JAMA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: JAMA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Jama Connect',
    connectNoun: 'API credential',
    fields: [
      {
        id: 'orgId',
        label: 'Jama URL',
        placeholder: 'https://your-company.jamacloud.com',
        secret: false,
      },
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Enter your Jama client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Enter your Jama client secret',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/jama',
    helpText:
      'Create API credentials in your Jama profile. Your account needs REST API access and a Named Creator license.',
  },
  [ZOOMINFO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ZOOMINFO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'ZoomInfo',
    connectNoun: 'API app',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
        hint: 'Create a client credentials app in the ZoomInfo Developer Portal. Its integration user and scopes apply to every call.',
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/zoominfo',
  },
  [SAILPOINT_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SAILPOINT_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'SailPoint',
    connectNoun: 'API client',
    fields: [
      {
        id: 'orgId',
        label: 'Tenant',
        placeholder: 'acme or acme.api.identitynow.com',
        secret: false,
        hintPattern: SAILPOINT_API_HOST_REGEX,
        hintNormalize: (value) => normalizeSailPointTenantHost(value) ?? value.trim().toLowerCase(),
        hintMessage:
          'Expected your tenant name or its API host, like acme, acme.api.identitynow.com, or agency.api.identitynowgov.com.',
      },
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
        hint: 'Use an API client with the client credentials grant, or a personal access token.',
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/sailpoint',
    helpText:
      'The tenant name is shown under Admin > Dashboard > Overview. For a vanity domain, use the tenant name.',
  },
  [DATADOG_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: DATADOG_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Datadog',
    connectNoun: 'API key pair',
    fields: [
      {
        id: 'dataCenter',
        label: 'Site',
        placeholder: 'Select a site',
        secret: false,
        options: DATADOG_SITES.map((site) => ({ value: site, label: DATADOG_SITE_LABELS[site] })),
        hint: 'The site in the address you sign in to Datadog with.',
      },
      {
        id: 'clientId',
        label: 'API key',
        placeholder: 'Paste the API key',
        secret: true,
        hint: 'Create keys in Datadog under Organization Settings > API Keys and Application Keys.',
      },
      {
        id: 'clientSecret',
        label: 'Application key',
        placeholder: 'Paste the application key',
        secret: true,
        hint: 'Workflows act with this key and its scopes. Datadog checks it on the first request that needs it.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/datadog',
  },
  [CROWDSTRIKE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CROWDSTRIKE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'CrowdStrike',
    connectNoun: 'API client',
    fields: [
      {
        id: 'dataCenter',
        label: 'Cloud',
        placeholder: 'Select a cloud',
        secret: false,
        // The Falcon console names each cloud by its id in upper case (US-1, US-GOV-1).
        options: CROWDSTRIKE_CLOUDS.map((cloud) => ({ value: cloud, label: cloud.toUpperCase() })),
        hint: 'The Falcon cloud your console signs in to.',
      },
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
        hint: 'Create the API client in Falcon under Support and resources > API clients and keys, with the scopes your workflows need.',
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
      {
        id: 'orgId',
        label: 'Member CID',
        placeholder: 'Only for an MSSP parent CID',
        secret: false,
        optional: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/crowdstrike',
    helpText:
      'Leave blank unless the API client belongs to a parent CID and every call should act on one child CID.',
  },
  [DOCUSIGN_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: DOCUSIGN_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'DocuSign',
    connectNoun: 'JWT Grant app',
    fields: [
      {
        id: 'dataCenter',
        label: 'Environment',
        placeholder: 'Select an environment',
        secret: false,
        options: (Object.keys(DOCUSIGN_ENVIRONMENTS) as DocuSignEnvironment[]).map((id) => ({
          value: id,
          label: DOCUSIGN_ENVIRONMENTS[id].label,
        })),
        hint: 'Where the integration key was created. Keys start in the developer environment until they go live.',
      },
      {
        id: 'clientId',
        label: 'Integration key',
        placeholder: '00000000-0000-0000-0000-000000000000',
        secret: false,
        hintPattern: DOCUSIGN_GUID_REGEX,
        hintNormalize: (value) => value.trim(),
        hintMessage: 'Expected the integration key GUID from Apps and Keys.',
      },
      {
        id: 'username',
        label: 'Impersonated user ID',
        placeholder: '00000000-0000-0000-0000-000000000000',
        secret: false,
        hintPattern: DOCUSIGN_GUID_REGEX,
        hintNormalize: (value) => value.trim(),
        hintMessage: 'Expected the User ID GUID from Apps and Keys, not an email address.',
        hint: 'Every call runs as this user, with their DocuSign permissions.',
      },
      {
        id: 'privateKey',
        label: 'RSA private key',
        placeholder: '-----BEGIN RSA PRIVATE KEY-----',
        secret: true,
        multiline: true,
        hintPattern: DOCUSIGN_PRIVATE_KEY_REGEX,
        hintNormalize: (value) => value.trim(),
        hintMessage:
          'Expected the full PEM private key from the RSA keypair, including its BEGIN and END lines.',
      },
      {
        id: 'orgId',
        label: 'Account ID',
        placeholder: "Defaults to the user's default account",
        secret: false,
        optional: true,
        hintPattern: DOCUSIGN_GUID_REGEX,
        hintNormalize: (value) => value.trim(),
        hintMessage: 'Expected the API Account ID GUID from Apps and Keys.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/docusign-service-account',
    helpText:
      "Only needed when the user belongs to more than one account and the one to use isn't their default.",
    consentUrl: (values, redirectUri) =>
      buildDocuSignConsentUrl(values.clientId ?? '', values.dataCenter, redirectUri),
  },
  [ZENDESK_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ZENDESK_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Zendesk',
    connectNoun: 'API credential',
    fields: [
      {
        id: 'authMethod',
        label: 'Authentication method',
        placeholder: 'Select a method',
        secret: false,
        optional: true,
        options: [
          {
            value: ZENDESK_AUTH_METHODS.clientCredentials,
            label: 'OAuth client (client credentials)',
          },
          { value: ZENDESK_AUTH_METHODS.apiToken, label: 'API token (deprecated by Zendesk)' },
        ],
      },
      {
        id: 'orgId',
        label: 'Subdomain',
        placeholder: 'your-company',
        secret: false,
        hintPattern: ZENDESK_SUBDOMAIN_REGEX,
        hintNormalize: normalizeZendeskSubdomain,
        hintMessage: 'Expected the subdomain from your-company.zendesk.com, like your-company.',
      },
      {
        id: 'clientId',
        label: 'Client identifier',
        placeholder: 'Paste the OAuth client unique identifier',
        secret: false,
        optional: true,
        requiredForAuthMethods: [ZENDESK_AUTH_METHODS.clientCredentials],
        hint: 'Create a confidential OAuth client in Admin Center under Apps and integrations > APIs > OAuth Clients.',
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
        optional: true,
        requiredForAuthMethods: [ZENDESK_AUTH_METHODS.clientCredentials],
      },
      {
        id: 'scope',
        label: 'Permissions',
        placeholder: 'Select permissions',
        secret: false,
        optional: true,
        requiredForAuthMethods: [ZENDESK_AUTH_METHODS.clientCredentials],
        options: ZENDESK_SCOPE_OPTIONS,
        hint: 'Every call runs as the user the OAuth client belongs to, with that user’s Zendesk role.',
      },
      {
        id: 'username',
        label: 'Agent email',
        placeholder: 'agent@your-company.com',
        secret: false,
        optional: true,
        requiredForAuthMethods: [ZENDESK_AUTH_METHODS.apiToken],
        hint: 'Every call runs as this agent or admin, with their Zendesk role.',
      },
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste the API token',
        secret: true,
        optional: true,
        requiredForAuthMethods: [ZENDESK_AUTH_METHODS.apiToken],
        hint: 'Zendesk has deprecated API tokens in favor of OAuth. Use an OAuth client unless you cannot create one.',
      },
    ],
    defaultAuthMethod: ZENDESK_AUTH_METHODS.clientCredentials,
    docsUrl: 'https://docs.sim.ai/integrations/zendesk',
    helpText: 'Sim connects only to your-company.zendesk.com; host-mapped domains are not used.',
  },
  [RAMP_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: RAMP_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Ramp',
    connectNoun: 'application',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/ramp',
  },
  [GREENHOUSE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: GREENHOUSE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Greenhouse',
    connectNoun: 'API credential',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/greenhouse',
  },
  [HELPSCOUT_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: HELPSCOUT_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Help Scout',
    connectNoun: 'app',
    fields: [
      {
        id: 'clientId',
        label: 'App ID',
        placeholder: 'Paste the App ID',
        secret: false,
        hint: 'Create the app in Help Scout under Your Profile > My Apps.',
      },
      {
        id: 'clientSecret',
        label: 'App secret',
        placeholder: 'Paste the App Secret',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/helpscout',
  },
  [VANTA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: VANTA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Vanta',
    connectNoun: 'application',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
      {
        id: 'scope',
        label: 'Permissions',
        placeholder: 'Select permissions',
        secret: false,
        optional: true,
        options: VANTA_PERMISSION_OPTIONS,
      },
      {
        id: 'dataCenter',
        label: 'Deployment',
        placeholder: 'Select a deployment',
        secret: false,
        optional: true,
        options: [
          { value: 'us', label: 'Standard (US, EU, Australia)' },
          { value: 'gov', label: 'Vanta Government' },
        ],
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/vanta',
  },
  [FIVETRAN_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: FIVETRAN_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Fivetran',
    connectNoun: 'API key',
    fields: [
      {
        id: 'clientId',
        label: 'API key',
        placeholder: 'Paste the API key',
        secret: true,
        hint: 'In Fivetran, click your username, then API Key > Generate API key. The key acts with your Fivetran permissions.',
      },
      {
        id: 'clientSecret',
        label: 'API secret',
        placeholder: 'Paste the API secret',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/fivetran',
  },
  [ZOOM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ZOOM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Zoom',
    connectNoun: 'server-to-server app',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
      {
        id: 'orgId',
        label: 'Account ID',
        placeholder: 'Paste the account ID',
        secret: false,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/zoom-service-account',
    helpText:
      'The Account ID on the App Credentials page is not the account number shown in the Zoom web portal. The app must be activated before tokens can be issued.',
  },
  [BOX_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: BOX_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Box',
    connectNoun: 'service account',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
      {
        id: 'orgId',
        label: 'Enterprise ID',
        placeholder: '1234567',
        secret: false,
        hintPattern: /^\d+$/,
        hintMessage: 'Box Enterprise IDs are numeric.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/box-service-account',
    helpText:
      'A Box admin must authorize the app in the Admin Console first, and the Service Account only sees folders it has been invited to as a collaborator.',
  },
  [SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Salesforce',
    connectNoun: 'integration user app',
    fields: [
      {
        id: 'authMethod',
        label: 'Authentication method',
        placeholder: 'Select a method',
        secret: false,
        optional: true,
        options: SALESFORCE_AUTH_METHOD_OPTIONS,
      },
      {
        id: 'clientId',
        label: 'Consumer key',
        placeholder: 'Paste the consumer key',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Consumer secret',
        placeholder: 'Paste the consumer secret',
        secret: true,
        optional: true,
        requiredForAuthMethods: ['client_credentials'],
      },
      {
        id: 'privateKey',
        label: 'Private key',
        placeholder: '-----BEGIN PRIVATE KEY-----',
        secret: true,
        multiline: true,
        optional: true,
        requiredForAuthMethods: ['jwt_bearer'],
        hintPattern: SALESFORCE_PRIVATE_KEY_REGEX,
        hintMessage: 'Expected a PEM private key (server.key), not the certificate.',
        hint: 'Must match the certificate uploaded to the app.',
      },
      {
        id: 'username',
        label: 'Run as username',
        placeholder: 'integration.user@yourorg.com',
        secret: false,
        optional: true,
        requiredForAuthMethods: ['jwt_bearer'],
        hintPattern: SALESFORCE_USERNAME_REGEX,
        hintMessage: 'Expected a Salesforce username, which is email-shaped (user@example.com).',
      },
      {
        id: 'orgId',
        label: 'My Domain host',
        placeholder: 'yourorg.my.salesforce.com',
        secret: false,
        hintPattern: SALESFORCE_MY_DOMAIN_HOST_REGEX,
        hintNormalize: normalizeSalesforceMyDomainHost,
        hintMessage:
          'Expected a My Domain host like yourorg.my.salesforce.com, yourorg--sbx.sandbox.my.salesforce.com, or yourorg-dev-ed.develop.my.salesforce.com — not the my.salesforce-setup.com or lightning.force.com host.',
      },
    ],
    defaultAuthMethod: SALESFORCE_DEFAULT_AUTH_METHOD,
    docsUrl: 'https://docs.sim.ai/integrations/salesforce-service-account',
    helpText:
      'Every call runs as one integration user, so deactivating or freezing that user stops all runs. Without the "openid" scope the connection still works, but Sim cannot record which user it authenticates as.',
  },
  [ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Zoho Desk',
    connectNoun: 'Self Client',
    fields: [
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the client secret',
        secret: true,
      },
      {
        id: 'orgId',
        label: 'Organization ID',
        placeholder: '600123456',
        secret: false,
        hintPattern: ZOHO_DESK_SOID_REGEX,
        hintNormalize: normalizeZohoDeskSoid,
        hintMessage:
          'Expected a numeric organization ID like 600123456, or a full ZohoDesk.600123456 value.',
      },
      {
        id: 'dataCenter',
        label: 'Data center',
        // Deliberately region-neutral: on a reconnect an unset value keeps the
        // credential's stored region, so naming a region here would be wrong.
        placeholder: 'Select a data center',
        secret: false,
        optional: true,
        options: ZOHO_DESK_DATA_CENTER_OPTIONS,
        hint: 'The region your Zoho account signs in to. New credentials default to the United States.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/zoho-desk-service-account',
    helpText: 'Zoho Desk triggers still require an OAuth connection, which is US-only.',
  },
  [NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Oracle NetSuite',
    connectNoun: 'OAuth certificate',
    fields: [
      {
        id: 'orgId',
        label: 'SuiteTalk URL',
        placeholder: 'https://1234567-sb1.suitetalk.api.netsuite.com',
        secret: false,
        hintPattern: NETSUITE_SUITETALK_ORIGIN_REGEX,
        hintNormalize: (value) =>
          normalizeNetSuiteSuiteTalkOrigin(value) ?? value.trim().toLowerCase(),
        hintMessage:
          'Expected the HTTPS SuiteTalk Company URL with no path, port, query, or fragment.',
      },
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the integration record client ID',
        secret: false,
      },
      {
        id: 'certificateId',
        label: 'Certificate ID',
        placeholder: 'Paste the certificate mapping ID',
        secret: false,
      },
      {
        id: 'privateKey',
        label: 'Private key',
        placeholder: '-----BEGIN PRIVATE KEY-----',
        secret: true,
        multiline: true,
        hintPattern: /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/,
        hintMessage: 'Expected the PEM private key paired with the uploaded certificate.',
        hint: 'Must match the certificate mapping in this NetSuite account and environment.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/netsuite-service-account',
    helpText:
      'Use the account-specific SuiteTalk URL and the client ID, certificate ID, and private key from one OAuth 2.0 client-credentials mapping.',
  },
  [ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Oracle EPM Cloud',
    connectNoun: 'integration user',
    fields: [
      {
        id: 'orgId',
        label: 'REST Base URL',
        placeholder: 'https://example.oraclecloud.com',
        secret: false,
        hintPattern: /^https:\/\//,
        hintMessage: 'Expected the HTTPS REST base URL for one Oracle EPM environment.',
        hint: 'Enter the HTTPS base URL for your environment without /epmcloud or an API endpoint path. Include a gateway prefix only if your deployment requires it.',
      },
      {
        id: 'clientId',
        label: 'Integration username',
        placeholder: 'integration.user@example.com',
        secret: false,
        hint: 'Basic authentication requires a user without MFA. Credentials are checked on the first product request.',
      },
      {
        id: 'clientSecret',
        label: 'Password',
        placeholder: 'Paste the integration user password',
        secret: true,
        preserveWhitespace: true,
      },
    ],
    docsUrl:
      'https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/authentication.html',
    helpText:
      'The credential is bound to one EPM environment. Use a dedicated integration user with only the permissions its workflows require.',
  },
  [ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Oracle Fusion',
    connectNoun: 'integration user',
    fields: [
      {
        id: 'orgId',
        label: 'Fusion Applications URL',
        placeholder: 'https://your-environment.fa.ocs.oraclecloud.com',
        secret: false,
        hintPattern: ORACLE_FUSION_APPLICATION_ORIGIN_REGEX,
        hintNormalize: (value) =>
          normalizeOracleFusionApplicationOrigin(value) ?? value.trim().toLowerCase(),
        hintMessage:
          'Expected the Oracle-assigned HTTPS application URL with no path, port, credentials, query, or fragment.',
      },
      {
        id: 'clientId',
        label: 'Integration username',
        placeholder: 'Paste the integration username',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Password',
        placeholder: 'Paste the password',
        secret: true,
        preserveWhitespace: true,
      },
    ],
    docsUrl: 'https://docs.oracle.com/en/cloud/saas/applications-common/26b/farca/Quick_Start.html',
    helpText:
      'The application URL is validated when saved. Oracle authenticates the integration user on the first product request.',
  },
}

/**
 * Required contract fields per client-credential provider, consumed by the
 * `createCredentialBodySchema` superRefine so validation errors name the exact
 * missing field. Derived from each descriptor's field list, minus the fields
 * marked `optional`.
 */
export const CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS: Record<
  string,
  ClientCredentialAccountFieldId[]
> = Object.fromEntries(
  Object.values(CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS).map((descriptor) => [
    descriptor.providerId,
    descriptor.fields.filter((field) => !field.optional).map((field) => field.id),
  ])
)

/**
 * Resolves a submitted or stored `authMethod` to one the descriptor actually
 * offers, falling back to its `defaultAuthMethod`. Returns `undefined` for
 * single-grant providers, whose fields are never method-conditional.
 *
 * Resolving (rather than reading the raw value) is what makes credentials
 * created before the field existed keep working: their blob carries no
 * `authMethod`, and the default is the grant they were created with.
 */
export function resolveClientCredentialAuthMethod(
  descriptor: ClientCredentialAccountDescriptor,
  authMethod: string | undefined
): string | undefined {
  const options = descriptor.fields.find((field) => field.id === AUTH_METHOD_FIELD_ID)?.options
  if (!options) return undefined
  const trimmed = authMethod?.trim()
  return options.some((option) => option.value === trimmed) ? trimmed : descriptor.defaultAuthMethod
}

/**
 * Splits a descriptor's fields for one auth method: `visible` is what the
 * connect modal renders, `required` is what must be non-empty to submit.
 *
 * A field with no `requiredForAuthMethods` belongs to every branch and is
 * required unless marked `optional`; a branch-specific field is both hidden
 * and skipped by validation on the other branches. Resolves the method once,
 * so callers never re-resolve per field.
 *
 * The static {@link CLIENT_CREDENTIAL_ACCOUNT_REQUIRED_FIELDS} map above
 * cannot express this — it feeds a contract schema that validates one shape
 * per provider — so the branch-specific requirement is enforced by the
 * server-side secret builder and mirrored by the connect modal's submit gate.
 */
export function partitionClientCredentialFields(
  descriptor: ClientCredentialAccountDescriptor,
  authMethod: string | undefined
): { visible: ClientCredentialAccountField[]; required: ClientCredentialAccountField[] } {
  const resolved = resolveClientCredentialAuthMethod(descriptor, authMethod)
  const visible: ClientCredentialAccountField[] = []
  const required: ClientCredentialAccountField[] = []
  for (const field of descriptor.fields) {
    if (field.requiredForAuthMethods) {
      if (resolved === undefined || !field.requiredForAuthMethods.includes(resolved)) continue
      visible.push(field)
      required.push(field)
      continue
    }
    visible.push(field)
    if (!field.optional) required.push(field)
  }
  return { visible, required }
}

/**
 * Resolves an auth method against the Salesforce descriptor's own option list,
 * for the minter — which holds only the raw stored value and must agree with
 * the validation that gated the credential at create time.
 */
export function resolveSalesforceAuthMethod(authMethod: string | undefined): string {
  return (
    resolveClientCredentialAuthMethod(
      CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS[SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID],
      authMethod
    ) ?? SALESFORCE_DEFAULT_AUTH_METHOD
  )
}

/** Resolves a stored Zendesk auth method against the descriptor's options, for the minter. */
export function resolveZendeskAuthMethod(authMethod: string | undefined): string {
  return (
    resolveClientCredentialAuthMethod(
      CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS[ZENDESK_SERVICE_ACCOUNT_PROVIDER_ID],
      authMethod
    ) ?? ZENDESK_AUTH_METHODS.clientCredentials
  )
}

export function isClientCredentialAccountProviderId(
  value: string | null | undefined
): value is ClientCredentialAccountProviderId {
  return Boolean(value && Object.hasOwn(CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS, value))
}

export function getClientCredentialAccountDescriptor(
  providerId: string | null | undefined
): ClientCredentialAccountDescriptor | undefined {
  return isClientCredentialAccountProviderId(providerId)
    ? CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS[providerId]
    : undefined
}
