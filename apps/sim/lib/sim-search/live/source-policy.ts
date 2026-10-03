import { NativeSearchError, string } from '@/lib/sim-search/live/http'
import {
  defaultLiveSearchPolicy,
  type LiveSearchPolicy,
  normalizeLiveSearchPolicy,
} from '@/lib/sim-search/live/policy-schema'
import { parseMultiValue } from '@/connectors/utils'

const RESOURCE_FIELDS: Record<string, string> = {
  google_drive: 'folderId',
  gmail: 'label',
  google_calendar: 'calendarId',
  confluence: 'spaceKey',
  coda: 'docIds',
}

/** Live search consumes the source's canonical resource settings; crawl batch sizes have no meaning here. */
export function liveSourcePolicy(
  provider: string,
  config: Record<string, unknown>
): LiveSearchPolicy {
  const policy = defaultLiveSearchPolicy(provider)
  const field = RESOURCE_FIELDS[provider]
  if (!field)
    throw new NativeSearchError(
      'unavailable',
      'This integration does not support service account search.'
    )
  const selected = parseMultiValue(config[field])
  if (provider === 'confluence' && !selected.length)
    throw new NativeSearchError(
      'unavailable',
      'Choose Confluence spaces or All in the service account source.'
    )
  policy.included = selected.length === 1 && selected[0] === '*' ? [] : selected
  if (provider === 'google_calendar' && !policy.included.length) policy.included = ['primary']
  policy.mode = policy.included.length ? 'selected' : 'all'
  if (provider === 'google_drive') {
    const mime: Record<string, string[]> = {
      documents: ['application/vnd.google-apps.document'],
      spreadsheets: ['application/vnd.google-apps.spreadsheet'],
      presentations: ['application/vnd.google-apps.presentation'],
      text: [
        'text/plain',
        'text/csv',
        'text/html',
        'text/markdown',
        'application/json',
        'application/xml',
      ],
    }
    policy.fileTypes = mime[string(config.fileType)] ?? []
  }
  if (provider === 'gmail') {
    policy.excludePromotions = config.excludePromotions !== 'false'
    policy.excludeSocial = config.excludeSocial !== 'false'
  }
  if (provider === 'google_calendar') policy.includeAttendees = config.includeAttendees !== 'false'
  if (provider === 'confluence' && config.domain) policy.sites = [string(config.domain)]
  return normalizeLiveSearchPolicy(provider, policy)
}
