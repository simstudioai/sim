/**
 * Client-safe descriptors for client-credentials service-account providers.
 *
 * A client-credential account is a `service_account`-type credential where a
 * workspace admin pastes an OAuth client id + client secret + provider org
 * identifier instead of a long-lived token. Unlike the token-paste family
 * (whose stored secret IS the access token), these credentials mint a
 * short-lived access token on demand via the provider's client-credentials
 * grant (Zoom Server-to-Server OAuth, Box CCG). This module holds only
 * UI/contract metadata (field lists, labels, docs links); the server-side
 * minting registry lives in `@/lib/credentials/client-credential-accounts/server`.
 */

/** Discriminator stored inside every encrypted client-credential secret blob. */
export const CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE = 'client_credential_account' as const

/** Contract field ids a client-credential connect modal collects. */
export type ClientCredentialAccountFieldId = 'clientId' | 'clientSecret' | 'orgId' | 'dataCenter'

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
  /** Sim setup guide, docked bottom-left of the connect modal. */
  docsUrl: string
  /** Optional one-line caveat rendered in the connect modal. */
  helpText?: string
}

export const ZOOM_SERVICE_ACCOUNT_PROVIDER_ID = 'zoom-service-account' as const
export const BOX_SERVICE_ACCOUNT_PROVIDER_ID = 'box-service-account' as const
export const SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID = 'salesforce-service-account' as const
export const ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID = 'zoho-desk-service-account' as const

export type ClientCredentialAccountProviderId =
  | typeof ZOOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof BOX_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ZOHO_DESK_SERVICE_ACCOUNT_PROVIDER_ID

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
      },
      {
        id: 'orgId',
        label: 'My Domain host',
        placeholder: 'yourorg.my.salesforce.com',
        secret: false,
        hintPattern: SALESFORCE_MY_DOMAIN_HOST_REGEX,
        hintNormalize: normalizeSalesforceMyDomainHost,
        hintMessage:
          'Expected a My Domain host like yourorg.my.salesforce.com, yourorg--sbx.sandbox.my.salesforce.com, or yourorg-dev-ed.develop.my.salesforce.com.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/salesforce-service-account',
    helpText:
      'Every call executes as the Connected App\'s "Run As" user, so deactivating or freezing that user stops all runs. Without the "openid" scope the connection still works, but Sim cannot record which user it authenticates as.',
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
