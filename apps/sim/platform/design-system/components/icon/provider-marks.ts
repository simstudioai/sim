import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

const SHARED_MARKS = new Map<string, IconName>([
  ['gmail', 'I005'],
  ['linear', 'I007'],
  ['notion', 'I022'],
  ['github', 'I045'],
  ['salesforce', 'I084'],
  ['google_calendar', 'I088'],
  ['outlook', 'I120'],
  ['slack', 'I123'],
])

const ASSET_MARKS = new Set([
  'airtable',
  'asana',
  'attio',
  'bitbucket',
  'box',
  'calcom',
  'clickup',
  'coda',
  'confluence',
  'databricks',
  'docusign',
  'dropbox',
  'fireflies',
  'gitlab',
  'google-chat',
  'google-docs',
  'google_drive',
  'google-forms',
  'google_meet',
  'google-sheets',
  'granola',
  'hubspot',
  'jira',
  'linkedin',
  'lucid',
  'microsoft-excel',
  'microsoft-teams',
  'monday',
  'onedrive',
  'pipedrive',
  'sharepoint',
  'wordpress',
  'zoom',
])

export function providerMark(providerId: string): IconName | { href: string } {
  const shared = SHARED_MARKS.get(providerId)
  if (shared) return shared
  if (!ASSET_MARKS.has(providerId)) return 'I070'
  return { href: `/provider-marks/${providerId.replaceAll('_', '-')}.svg#mark` }
}
