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

/** Discriminator stored inside every encrypted client-credential secret blob. */
export const CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE = 'client_credential_account' as const

/** Contract field ids a client-credential connect modal collects. */
export type ClientCredentialAccountFieldId =
  | 'clientId'
  | 'clientSecret'
  | 'certificateId'
  | 'orgId'
  | 'dataCenter'
  | 'authMethod'
  | 'privateKey'
  | 'username'
  | 'instanceUrl'
  | 'tokenUrl'
  | 'scope'

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
  /** Optional one-line caveat rendered in the connect modal. */
  helpText?: string
}

export const ZOOM_SERVICE_ACCOUNT_PROVIDER_ID = 'zoom-service-account' as const
export const BOX_SERVICE_ACCOUNT_PROVIDER_ID = 'box-service-account' as const
export const SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID = 'salesforce-service-account' as const
export const ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID = 'zoho-desk-service-account' as const
export const NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID = 'netsuite-service-account' as const
export const ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID = 'oracle-fusion-service-account' as const

export type ClientCredentialAccountProviderId =
  | typeof ZOOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BOX_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof NETSUITE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID

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

/** Canonical Oracle-assigned Fusion Applications origin used by REST integrations. */
export const ORACLE_FUSION_APPLICATION_ORIGIN_REGEX =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.fa\.(?:ocs|[a-z0-9-]+)\.oraclecloud\.com$/

/** OCI IAM identity-domain token endpoint used by Fusion client credentials. */
export const ORACLE_FUSION_TOKEN_URL_REGEX =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.identity\.oraclecloud\.com\/oauth2\/v1\/token$/

function normalizeExactHttpsUrl(rawUrl: string, pattern: RegExp, originOnly: boolean) {
  try {
    const trimmed = rawUrl.trim()
    const authority = /^https:\/\/([^/?#]+)/i.exec(trimmed)?.[1]
    if (!authority || /:\d+$/.test(authority)) return undefined
    const parsed = new URL(trimmed)
    if (
      parsed.protocol !== 'https:' ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (originOnly && parsed.pathname !== '' && parsed.pathname !== '/')
    ) {
      return undefined
    }
    const normalized = originOnly ? parsed.origin : parsed.toString().replace(/\/$/, '')
    return pattern.test(normalized) ? normalized : undefined
  } catch {
    return undefined
  }
}

export function normalizeOracleFusionApplicationOrigin(rawUrl: string): string | undefined {
  return normalizeExactHttpsUrl(rawUrl, ORACLE_FUSION_APPLICATION_ORIGIN_REGEX, true)
}

export function normalizeOracleFusionTokenUrl(rawUrl: string): string | undefined {
  return normalizeExactHttpsUrl(rawUrl, ORACLE_FUSION_TOKEN_URL_REGEX, false)
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

export const CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS: Record<
  ClientCredentialAccountProviderId,
  ClientCredentialAccountDescriptor
> = {
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
  [ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Oracle Fusion Cloud Financials',
    connectNoun: 'confidential application',
    fields: [
      {
        id: 'instanceUrl',
        label: 'Fusion Applications URL',
        placeholder: 'https://your-environment.fa.ocs.oraclecloud.com',
        secret: false,
        hintPattern: ORACLE_FUSION_APPLICATION_ORIGIN_REGEX,
        hintNormalize: (value) =>
          normalizeOracleFusionApplicationOrigin(value) ?? value.trim().toLowerCase(),
        hintMessage:
          'Expected the canonical Oracle-assigned HTTPS application URL with no path, port, query, or fragment.',
      },
      {
        id: 'tokenUrl',
        label: 'Access token URL',
        placeholder: 'https://idcs-xxxx.identity.oraclecloud.com/oauth2/v1/token',
        secret: false,
        hintPattern: ORACLE_FUSION_TOKEN_URL_REGEX,
        hintNormalize: (value) =>
          normalizeOracleFusionTokenUrl(value) ?? value.trim().toLowerCase(),
        hintMessage: 'Expected an OCI IAM identity-domain HTTPS URL ending in /oauth2/v1/token.',
      },
      {
        id: 'clientId',
        label: 'Client ID',
        placeholder: 'Paste the confidential application client ID',
        secret: false,
      },
      {
        id: 'clientSecret',
        label: 'Client secret',
        placeholder: 'Paste the confidential application client secret',
        secret: true,
      },
      {
        id: 'scope',
        label: 'Scope',
        placeholder: 'urn:opc:resource:fa:... urn:opc:resource:consumer::all',
        secret: false,
        hint: 'Use the IDCS_CONNECTOR_CLIENT_SCOPE value from the Oracle Applications Cloud (Fusion) service.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/oracle_fusion_financials',
    helpText:
      'Activate a Client Credentials confidential application, configure the client ID as a Fusion Applications user, and grant it least-privilege Payables read access for the required business units.',
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
