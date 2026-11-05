import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { publicAssetPath } from '@/platform/design-system/navigation'

const SHARED_MARKS = new Map<string, IconName>([
  ['gmail', 'I005'],
  ['google-email', 'I005'],
  ['google-calendar', 'I088'],
  ['linear', 'I007'],
  ['notion', 'I022'],
  ['github', 'I045'],
  ['salesforce', 'I084'],
  ['google_calendar', 'I088'],
  ['slack', 'I123'],
])

const ASSET_MARKS = new Set([
  'coda',
  'confluence',
  'fireflies',
  'gitlab',
  'google_drive',
  'google_meet',
  'granola',
  'hubspot',
  'jira',
  'lucid',
  'zoom',
])

export function providerMark(providerId: string): IconName | { href: string } {
  const shared = SHARED_MARKS.get(providerId)
  if (shared) return shared
  if (!ASSET_MARKS.has(providerId.replaceAll('-', '_'))) return 'I070'
  return { href: publicAssetPath(`/provider-marks/${providerId.replaceAll('_', '-')}.svg#mark`) }
}
