/**
 * Client-safe descriptors for token-paste service-account providers.
 *
 * A token service account is a `service_account`-type credential where a
 * workspace admin pastes a long-lived provider token (private-app token, PAT,
 * API key, …) instead of running an OAuth flow — mirroring the Atlassian
 * service-account pattern: the token is verified once server-side, encrypted,
 * and returned as the access token at execution time with no exchange or
 * refresh. This module holds only UI/contract metadata (field lists, labels,
 * docs links); server-side verification lives in
 * `@/lib/credentials/token-service-accounts/server`.
 */

/** Discriminator stored inside every encrypted token service-account secret blob. */
export const TOKEN_SERVICE_ACCOUNT_SECRET_TYPE = 'token_service_account' as const

/** Contract field ids a token service-account modal may collect. */
export type TokenServiceAccountFieldId = 'apiToken' | 'domain'

export interface TokenServiceAccountField {
  id: TokenServiceAccountFieldId
  label: string
  placeholder: string
  /** Rendered with SecretInput and never echoed back. */
  secret: boolean
  /** Soft-format hint shown while the current value doesn't match `hintPattern`. */
  hintPattern?: RegExp
  hintMessage?: string
}

export interface TokenServiceAccountDescriptor {
  /** Stable credential `providerId` (`<provider>-service-account`). */
  providerId: string
  /** Human service label used in modal copy and error messages (e.g. "HubSpot"). */
  serviceLabel: string
  /** Vendor noun for the pasted secret (e.g. "private app access token"). */
  tokenNoun: string
  fields: TokenServiceAccountField[]
  /** Sim setup guide, docked bottom-left of the connect modal. */
  docsUrl: string
  /** Optional one-line caveat rendered under the token field. */
  helpText?: string
}

export const HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID = 'hubspot-service-account' as const
export const AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID = 'airtable-service-account' as const
export const NOTION_SERVICE_ACCOUNT_PROVIDER_ID = 'notion-service-account' as const
export const ASANA_SERVICE_ACCOUNT_PROVIDER_ID = 'asana-service-account' as const
export const ATTIO_SERVICE_ACCOUNT_PROVIDER_ID = 'attio-service-account' as const
export const LINEAR_SERVICE_ACCOUNT_PROVIDER_ID = 'linear-service-account' as const
export const MONDAY_SERVICE_ACCOUNT_PROVIDER_ID = 'monday-service-account' as const
export const SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID = 'shopify-service-account' as const
export const WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID = 'webflow-service-account' as const
export const TRELLO_SERVICE_ACCOUNT_PROVIDER_ID = 'trello-service-account' as const
export const CALCOM_SERVICE_ACCOUNT_PROVIDER_ID = 'calcom-service-account' as const
export const WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID = 'wealthbox-service-account' as const

const SHOPIFY_DOMAIN_HINT_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i

export type TokenServiceAccountProviderId =
  | typeof HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof NOTION_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ASANA_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ATTIO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof LINEAR_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MONDAY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof TRELLO_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof CALCOM_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID

export const TOKEN_SERVICE_ACCOUNT_DESCRIPTORS: Record<
  TokenServiceAccountProviderId,
  TokenServiceAccountDescriptor
> = {
  [HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'HubSpot',
    tokenNoun: 'private app access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Private app access token',
        placeholder: 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        secret: true,
        hintPattern: /^pat-/i,
        hintMessage: 'HubSpot private app tokens usually start with pat-.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/hubspot-service-account',
    helpText:
      'Tokens are tied to the super admin who created the private app; if that user is removed from the portal, some calls may start failing.',
  },
  [AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: AIRTABLE_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Airtable',
    tokenNoun: 'personal access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Personal access token',
        placeholder: 'pat...',
        secret: true,
        hintPattern: /^pat/i,
        hintMessage: 'Airtable personal access tokens usually start with pat.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/airtable-service-account',
    helpText:
      'Enterprise Scale service-account tokens work here too — they use the same format as personal access tokens.',
  },
  [NOTION_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: NOTION_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Notion',
    tokenNoun: 'internal integration secret',
    fields: [
      {
        id: 'apiToken',
        label: 'Internal integration secret',
        placeholder: 'ntn_...',
        secret: true,
        hintPattern: /^(ntn_|secret_)/,
        hintMessage: 'Notion integration secrets usually start with ntn_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/notion-service-account',
    helpText:
      'Remember to connect the integration to the pages and databases it should access — a valid secret with no page connections can read nothing.',
  },
  [ASANA_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ASANA_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Asana',
    tokenNoun: 'access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Access token',
        placeholder: 'Paste a service account token or personal access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/asana-service-account',
    helpText:
      'Enterprise service account tokens and personal access tokens both work — they use the same format.',
  },
  [ATTIO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: ATTIO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Attio',
    tokenNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'Paste workspace API key',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/attio-service-account',
    helpText:
      'Check the scopes granted to the key in Attio — tools whose scopes are missing will fail at run time.',
  },
  [LINEAR_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: LINEAR_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Linear',
    tokenNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'lin_api_...',
        secret: true,
        hintPattern: /^lin_api_/,
        hintMessage: 'Linear personal API keys start with lin_api_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/linear-service-account',
  },
  [MONDAY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: MONDAY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'monday.com',
    tokenNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'Paste personal API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/monday-service-account',
    helpText:
      'monday.com issues one API token per user — regenerating it in monday breaks every integration using the old token.',
  },
  [SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Shopify',
    tokenNoun: 'Admin API access token',
    fields: [
      {
        id: 'apiToken',
        label: 'Admin API access token',
        placeholder: 'shpat_...',
        secret: true,
        hintPattern: /^shpat_/,
        hintMessage: 'Shopify Admin API access tokens usually start with shpat_.',
      },
      {
        id: 'domain',
        label: 'Store domain',
        placeholder: 'your-store.myshopify.com',
        secret: false,
        hintPattern: SHOPIFY_DOMAIN_HINT_REGEX,
        hintMessage: 'Shopify store domains look like your-store.myshopify.com.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/shopify-service-account',
    helpText:
      'Shopify reveals the Admin API token only once at app creation, and new custom apps are created from the Dev Dashboard or CLI. The token is store-bound and does not expire.',
  },
  [WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: WEBFLOW_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Webflow',
    tokenNoun: 'site API token',
    fields: [
      {
        id: 'apiToken',
        label: 'Site API token',
        placeholder: 'Paste site API token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/webflow-service-account',
    helpText:
      'Create the token with at least the sites:read and CMS read/write scopes. Site tokens expire after 365 days without API activity, and each token grants access to a single site.',
  },
  [TRELLO_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: TRELLO_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Trello',
    tokenNoun: 'API token',
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        placeholder: 'ATTA...',
        secret: true,
        hintPattern: /^ATTA/,
        hintMessage: 'Trello API tokens usually start with ATTA.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/trello-service-account',
    helpText:
      "Generate the token with the setup guide's authorize link (expiration=never) so it works with Sim and doesn't expire.",
  },
  [CALCOM_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: CALCOM_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Cal.com',
    tokenNoun: 'API key',
    fields: [
      {
        id: 'apiToken',
        label: 'API key',
        placeholder: 'cal_live_...',
        secret: true,
        hintPattern: /^cal_/,
        hintMessage: 'Cal.com API keys usually start with cal_.',
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/calcom-service-account',
    helpText: 'Choose a non-expiring key (or note the expiry date) when creating it in Cal.com.',
  },
  [WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID]: {
    providerId: WEALTHBOX_SERVICE_ACCOUNT_PROVIDER_ID,
    serviceLabel: 'Wealthbox',
    tokenNoun: 'API access token',
    fields: [
      {
        id: 'apiToken',
        label: 'API access token',
        placeholder: 'Paste API access token',
        secret: true,
      },
    ],
    docsUrl: 'https://docs.sim.ai/integrations/wealthbox-service-account',
    helpText: 'API access must be enabled for your Wealthbox account before tokens can be created.',
  },
}

/**
 * Required contract fields per token service-account provider, consumed by the
 * `createCredentialBodySchema` superRefine so validation errors name the exact
 * missing field. Derived from each descriptor's field list.
 */
export const TOKEN_SERVICE_ACCOUNT_REQUIRED_FIELDS: Record<string, TokenServiceAccountFieldId[]> =
  Object.fromEntries(
    Object.values(TOKEN_SERVICE_ACCOUNT_DESCRIPTORS).map((descriptor) => [
      descriptor.providerId,
      descriptor.fields.map((field) => field.id),
    ])
  )

export function isTokenServiceAccountProviderId(
  value: string | null | undefined
): value is TokenServiceAccountProviderId {
  return Boolean(value && Object.hasOwn(TOKEN_SERVICE_ACCOUNT_DESCRIPTORS, value))
}

export function getTokenServiceAccountDescriptor(
  providerId: string | null | undefined
): TokenServiceAccountDescriptor | undefined {
  return isTokenServiceAccountProviderId(providerId)
    ? TOKEN_SERVICE_ACCOUNT_DESCRIPTORS[providerId]
    : undefined
}
