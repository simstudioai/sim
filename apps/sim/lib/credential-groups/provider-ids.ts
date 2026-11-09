/**
 * The providers an organization's accounts can come from, apart from their OAuth service configs so
 * contracts and client code can name them without bundling every provider's config and icon.
 */

export const CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS = [
  'gmail',
  'google-calendar',
  'google-drive',
  'google-docs',
  'google-forms',
  'google-chat',
  'google-meet',
  'google-sheets',
  'microsoft-teams',
  'outlook',
  'onedrive',
  'sharepoint',
  'microsoft-excel',
  'confluence',
  'jira',
  'airtable',
  'asana',
  'attio',
  'bitbucket',
  'github-repositories',
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

export const CREDENTIAL_GROUP_PROVIDER_IDS = [
  ...CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS,
  'slack',
] as const
