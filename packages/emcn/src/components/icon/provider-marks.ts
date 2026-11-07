import type { IconName } from '#emcn/catalog/icon-geometry'
import { providerMarkIds } from '#emcn/components/icon/provider-mark-ids.generated'

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
  'google_sheets',
  'granola',
  'hubspot',
  'jira',
  'lucid',
  'zoom',
])

const CATALOG_MARKS: ReadonlySet<string> = new Set(providerMarkIds)

/** What a provider without its own mark gets. */
export const FALLBACK_PROVIDER_MARK: IconName = 'I070'

export function providerMark(providerId: string, assetBasePath = ''): IconName | { href: string } {
  const shared = SHARED_MARKS.get(providerId)
  if (shared) return shared
  if (ASSET_MARKS.has(providerId.replaceAll('-', '_')))
    return { href: `${assetBasePath}/provider-marks/${providerId.replaceAll('_', '-')}.svg#mark` }
  if (CATALOG_MARKS.has(providerId))
    return { href: `${assetBasePath}/provider-marks/catalog.svg#${providerId}` }
  return FALLBACK_PROVIDER_MARK
}
