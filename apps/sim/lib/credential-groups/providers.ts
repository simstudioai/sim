import type { ReactNode } from 'react'
import { FirefliesIcon, GrainIcon, GranolaIcon, S3Icon } from '@/components/icons'
import type { OAuthServiceConfig } from '@/lib/oauth'
import { getServiceConfigByServiceId } from '@/lib/oauth'

export const CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS = [
  'gmail',
  'google-calendar',
  'confluence',
  'jira',
  'airtable',
  'asana',
  'attio',
  'box',
  'calcom',
  'clickup',
  'docusign',
  'dropbox',
  'hubspot',
  'linear',
  'linkedin',
  'monday',
  'notion',
  'pipedrive',
  'salesforce',
  'wordpress',
  'zoom',
] as const

export type CredentialGroupStandardOAuthProvider =
  (typeof CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS)[number]

/**
 * Services whose per-person credential is an API key rather than an OAuth grant.
 *
 * These have no entry in `OAUTH_PROVIDERS` and must not gain one — `OAuthServiceConfig`
 * requires a `providerId` and `scopes`, neither of which means anything here — so their
 * presentation and provider id are declared inline on the support record instead of being
 * resolved through the OAuth service catalog.
 */
export const CREDENTIAL_GROUP_API_KEY_PROVIDER_IDS = [
  'aws',
  'fireflies',
  'grain',
  'granola',
] as const

export type CredentialGroupApiKeyProvider = (typeof CREDENTIAL_GROUP_API_KEY_PROVIDER_IDS)[number]

export const CREDENTIAL_GROUP_PROVIDER_IDS = [
  ...CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS,
  'slack',
  ...CREDENTIAL_GROUP_API_KEY_PROVIDER_IDS,
] as const

export type CredentialGroupProvider = (typeof CREDENTIAL_GROUP_PROVIDER_IDS)[number]

/** Providers whose enrollment runs through an OAuth adapter. */
export type CredentialGroupOAuthProvider = Exclude<
  CredentialGroupProvider,
  CredentialGroupApiKeyProvider
>

export interface CredentialGroupProviderPresentation {
  name: string
  icon: (props: { className?: string }) => ReactNode
}

/**
 * One value an invited person supplies for an API-key option.
 *
 * `secret: false` exists for the parts of a credential that identify rather than authenticate —
 * a tenant subdomain, a regional host. Those must stay out of the redaction catalog: they are
 * short, they recur in ordinary log lines, and substituting them would corrupt output that has
 * nothing to do with the credential.
 */
/**
 * Where an invited person goes to create the credential.
 *
 * `steps` rather than a bare link because these destinations differ in kind: Granola issues
 * keys from its desktop app, so it has no URL anyone else can link to. `url` is set only where the provider publishes a stable address for the
 * screen that creates the key — a help article is not one, and linking one under a provider's
 * name would send people somewhere other than where the label promises.
 *
 * Keep `steps` to the navigation itself. Why a provider does or does not have a link is our
 * problem, not the reader's.
 */
export interface CredentialGroupApiKeyLocation {
  steps: string
  url?: string
}

export interface CredentialGroupApiKeyField {
  id: string
  label: string
  placeholder: string
  secret: boolean
}

export type CredentialGroupProviderSupport =
  | {
      configuration: 'oauth' | 'slack_custom_bot'
      serviceId: string
      description: string
    }
  | {
      configuration: 'api_key'
      providerId: string
      description: string
      /** Every value the invited person must supply, in the order they are shown. */
      fields: readonly CredentialGroupApiKeyField[]
      keyLocation: CredentialGroupApiKeyLocation
      presentation: CredentialGroupProviderPresentation
    }

const CREDENTIAL_GROUP_PROVIDER_SUPPORT: Record<
  CredentialGroupProvider,
  CredentialGroupProviderSupport
> = {
  gmail: {
    serviceId: 'gmail',
    description: 'Let each person connect one Gmail account',
    configuration: 'oauth',
  },
  'google-calendar': {
    serviceId: 'google-calendar',
    description: 'Let each person connect one Google Calendar account',
    configuration: 'oauth',
  },
  confluence: {
    serviceId: 'confluence',
    description: 'Let each person connect one Confluence account',
    configuration: 'oauth',
  },
  jira: {
    serviceId: 'jira',
    description: 'Let each person connect one Jira account',
    configuration: 'oauth',
  },
  airtable: {
    serviceId: 'airtable',
    description: 'Let each person connect one Airtable account',
    configuration: 'oauth',
  },
  asana: {
    serviceId: 'asana',
    description: 'Let each person connect one Asana account',
    configuration: 'oauth',
  },
  attio: {
    serviceId: 'attio',
    description: 'Let each person connect one Attio account',
    configuration: 'oauth',
  },
  box: {
    serviceId: 'box',
    description: 'Let each person connect one Box account',
    configuration: 'oauth',
  },
  calcom: {
    serviceId: 'calcom',
    description: 'Let each person connect one Cal.com account',
    configuration: 'oauth',
  },
  clickup: {
    serviceId: 'clickup',
    description: 'Let each person connect one ClickUp account',
    configuration: 'oauth',
  },
  hubspot: {
    serviceId: 'hubspot',
    description: 'Let each person connect one HubSpot account',
    configuration: 'oauth',
  },
  linear: {
    serviceId: 'linear',
    description: 'Let each person connect one Linear account',
    configuration: 'oauth',
  },
  monday: {
    serviceId: 'monday',
    description: 'Let each person connect one monday.com account',
    configuration: 'oauth',
  },
  notion: {
    serviceId: 'notion',
    description: 'Let each person connect one Notion account',
    configuration: 'oauth',
  },
  docusign: {
    serviceId: 'docusign',
    description: 'Let each person connect one DocuSign account',
    configuration: 'oauth',
  },
  dropbox: {
    serviceId: 'dropbox',
    description: 'Let each person connect one Dropbox account',
    configuration: 'oauth',
  },
  linkedin: {
    serviceId: 'linkedin',
    description: 'Let each person connect one LinkedIn account',
    configuration: 'oauth',
  },
  pipedrive: {
    serviceId: 'pipedrive',
    description: 'Let each person connect one Pipedrive account',
    configuration: 'oauth',
  },
  salesforce: {
    serviceId: 'salesforce',
    description: 'Let each person connect one Salesforce account',
    configuration: 'oauth',
  },
  wordpress: {
    serviceId: 'wordpress',
    description: 'Let each person connect one WordPress.com account',
    configuration: 'oauth',
  },
  zoom: {
    serviceId: 'zoom',
    description: 'Let each person connect one Zoom account',
    configuration: 'oauth',
  },
  slack: {
    serviceId: 'slack',
    description: 'Let each person connect through your custom Slack app',
    configuration: 'slack_custom_bot',
  },
  aws: {
    configuration: 'api_key',
    providerId: 'aws',
    description: 'Let each person share their own AWS access key',
    fields: [
      {
        id: 'accessKeyId',
        label: 'Access key ID',
        placeholder: 'AKIAIOSFODNN7EXAMPLE',
        secret: true,
      },
      {
        id: 'secretAccessKey',
        label: 'Secret access key',
        placeholder: 'Paste your secret access key',
        secret: true,
      },
      {
        /**
         * Not a secret: a region is a short, public, endlessly recurring string, and
         * cataloguing it for redaction would rewrite `us-east-1` out of unrelated log lines.
         */
        id: 'region',
        label: 'Region',
        placeholder: 'us-east-1',
        secret: false,
      },
    ],
    keyLocation: {
      steps:
        'In the AWS console, open IAM, then your user, then Security credentials, then Create access key.',
      url: 'https://console.aws.amazon.com/iam/',
    },
    presentation: { name: 'AWS', icon: S3Icon },
  },
  fireflies: {
    configuration: 'api_key',
    providerId: 'fireflies',
    description: 'Let each person share their own Fireflies API key',
    fields: [
      {
        id: 'apiKey',
        label: 'Fireflies API key',
        placeholder: 'Paste your Fireflies API key',
        secret: true,
      },
    ],
    keyLocation: { steps: 'In Fireflies, open Integrations and select Fireflies API.' },
    presentation: { name: 'Fireflies', icon: FirefliesIcon },
  },
  grain: {
    configuration: 'api_key',
    providerId: 'grain',
    description: 'Let each person share their own Grain API key',
    fields: [
      {
        id: 'apiKey',
        label: 'Grain API key',
        placeholder: 'Paste your Grain personal access token',
        secret: true,
      },
    ],
    keyLocation: {
      steps: 'In Grain, open Workspace settings, then Integrations, then the API tab.',
      url: 'https://grain.com/app/settings/integrations?tab=api',
    },
    presentation: { name: 'Grain', icon: GrainIcon },
  },
  granola: {
    configuration: 'api_key',
    providerId: 'granola',
    description: 'Let each person share their own Granola API key',
    fields: [
      {
        id: 'apiKey',
        label: 'Granola API key',
        placeholder: 'Paste your Granola API key',
        secret: true,
      },
    ],
    keyLocation: {
      steps: 'In the Granola desktop app, open Settings, then Connectors, then API keys.',
    },
    presentation: { name: 'Granola', icon: GranolaIcon },
  },
}

export function isCredentialGroupProvider(value: string): value is CredentialGroupProvider {
  return CREDENTIAL_GROUP_PROVIDER_IDS.some((provider) => provider === value)
}

export function isCredentialGroupStandardOAuthProvider(
  value: CredentialGroupProvider
): value is CredentialGroupStandardOAuthProvider {
  return CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.some((provider) => provider === value)
}

export function isCredentialGroupApiKeyProvider(
  value: CredentialGroupProvider
): value is CredentialGroupApiKeyProvider {
  return CREDENTIAL_GROUP_API_KEY_PROVIDER_IDS.some((provider) => provider === value)
}

/**
 * Throws for an API-key provider, which has no OAuth service to resolve. Call it only
 * behind {@link isCredentialGroupApiKeyProvider}, or use
 * {@link getCredentialGroupProviderPresentation} when all you need is a name and an icon.
 */
export function getCredentialGroupProviderService(
  provider: CredentialGroupProvider
): OAuthServiceConfig {
  const support = CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
  if (support.configuration === 'api_key') {
    throw new Error(`Credential Group provider ${provider} is not an OAuth service`)
  }
  const service = getServiceConfigByServiceId(support.serviceId)
  if (!service) {
    throw new Error(
      `Credential Group provider ${provider} references missing OAuth service ${support.serviceId}`
    )
  }
  return service
}

/** Name and icon for any provider, whichever catalog it is declared in. */
export function getCredentialGroupProviderPresentation(
  provider: CredentialGroupProvider
): CredentialGroupProviderPresentation {
  const support = CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
  if (support.configuration === 'api_key') return support.presentation
  const service = getCredentialGroupProviderService(provider)
  return { name: service.name, icon: service.icon }
}

export function getCredentialGroupProviderSupport(
  provider: CredentialGroupProvider
): CredentialGroupProviderSupport {
  return CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
}

/** Where the invited person creates this provider's credential. */
export function getCredentialGroupApiKeyLocation(
  provider: CredentialGroupApiKeyProvider
): CredentialGroupApiKeyLocation {
  const support = CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
  if (support.configuration !== 'api_key') {
    throw new Error(`Credential Group provider ${provider} does not collect API key fields`)
  }
  return support.keyLocation
}

/** The fields an API-key provider collects. Throws for any other provider. */
export function getCredentialGroupApiKeyFields(
  provider: CredentialGroupApiKeyProvider
): readonly CredentialGroupApiKeyField[] {
  const support = CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
  if (support.configuration !== 'api_key') {
    throw new Error(`Credential Group provider ${provider} does not collect API key fields`)
  }
  return support.fields
}

export function getCredentialGroupProviderId(provider: CredentialGroupProvider): string {
  const support = CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
  return support.configuration === 'api_key'
    ? support.providerId
    : getCredentialGroupProviderService(provider).providerId
}

export function getCredentialGroupProviderFromProviderId(
  providerId: string
): CredentialGroupProvider {
  const provider = CREDENTIAL_GROUP_PROVIDER_IDS.find(
    (candidate) => getCredentialGroupProviderId(candidate) === providerId
  )
  if (!provider) throw new Error(`Unsupported managed credential provider: ${providerId}`)
  return provider
}

export function getCredentialGroupStandardOAuthProviderFromProviderId(
  providerId: string
): CredentialGroupStandardOAuthProvider {
  const provider = CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.find(
    (candidate) => getCredentialGroupProviderId(candidate) === providerId
  )
  if (!provider) throw new Error(`Unsupported managed OAuth provider: ${providerId}`)
  return provider
}
