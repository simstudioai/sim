/**
 * Lightweight deployment metadata for OAuth services that also accept a
 * user-supplied service-account credential.
 *
 * This projection deliberately contains no icons, scopes, or OAuth runtime
 * configuration so deployment tooling can inspect integration availability
 * without loading the executable integration graph. Its parity with the
 * canonical OAuth service configuration is enforced by an invariant test.
 */

export interface ServiceAccountMetadata {
  providerId: string
  deploymentRequirement?: 'preview-gated' | 'oauth-client'
}

export const SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID: Readonly<
  Record<string, ServiceAccountMetadata>
> = {
  airtable: { providerId: 'airtable-service-account' },
  asana: { providerId: 'asana-service-account' },
  attio: { providerId: 'attio-service-account' },
  box: { providerId: 'box-service-account' },
  calcom: { providerId: 'calcom-service-account' },
  clickup: { providerId: 'clickup-service-account' },
  confluence: { providerId: 'atlassian-service-account' },
  gmail: { providerId: 'google-service-account' },
  'google-bigquery': { providerId: 'google-service-account' },
  'google-calendar': { providerId: 'google-service-account' },
  'google-contacts': { providerId: 'google-service-account' },
  'google-docs': { providerId: 'google-service-account' },
  'google-drive': { providerId: 'google-service-account' },
  'google-forms': { providerId: 'google-service-account' },
  'google-groups': { providerId: 'google-service-account' },
  'google-meet': { providerId: 'google-service-account' },
  'google-sheets': { providerId: 'google-service-account' },
  'google-tasks': { providerId: 'google-service-account' },
  'google-vault': { providerId: 'google-service-account' },
  hubspot: { providerId: 'hubspot-service-account' },
  jira: { providerId: 'atlassian-service-account' },
  linear: { providerId: 'linear-service-account' },
  monday: { providerId: 'monday-service-account' },
  notion: { providerId: 'notion-service-account' },
  pipedrive: { providerId: 'pipedrive-service-account' },
  salesforce: { providerId: 'salesforce-service-account' },
  shopify: { providerId: 'shopify-service-account' },
  slack: { providerId: 'slack-custom-bot', deploymentRequirement: 'preview-gated' },
  trello: { providerId: 'trello-service-account', deploymentRequirement: 'oauth-client' },
  wealthbox: { providerId: 'wealthbox-service-account' },
  webflow: { providerId: 'webflow-service-account' },
  'zoho-desk': { providerId: 'zoho-desk-service-account' },
  zoom: { providerId: 'zoom-service-account' },
} as const

export function getServiceAccountMetadata(
  oauthServiceId: string
): ServiceAccountMetadata | undefined {
  if (!Object.hasOwn(SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID, oauthServiceId)) {
    return undefined
  }
  return SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID[oauthServiceId]
}
