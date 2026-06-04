import { gmailPollingHandler } from '@/lib/webhooks/polling/gmail'
import { googleCalendarPollingHandler } from '@/lib/webhooks/polling/google-calendar'
import { googleDrivePollingHandler } from '@/lib/webhooks/polling/google-drive'
import { googleSheetsPollingHandler } from '@/lib/webhooks/polling/google-sheets'
import { hubspotPollingHandler } from '@/lib/webhooks/polling/hubspot'
import { imapPollingHandler } from '@/lib/webhooks/polling/imap'
import { outlookPollingHandler } from '@/lib/webhooks/polling/outlook'
import { rssPollingHandler } from '@/lib/webhooks/polling/rss'
import type { PollingProviderHandler } from '@/lib/webhooks/polling/types'

const POLLING_HANDLERS: Record<string, PollingProviderHandler> = {
  gmail: gmailPollingHandler,
  'google-calendar': googleCalendarPollingHandler,
  'google-drive': googleDrivePollingHandler,
  'google-sheets': googleSheetsPollingHandler,
  hubspot: hubspotPollingHandler,
  imap: imapPollingHandler,
  outlook: outlookPollingHandler,
  rss: rssPollingHandler,
}

export const VALID_POLLING_PROVIDERS = new Set(Object.keys(POLLING_HANDLERS))

/** Look up the polling handler for a provider. */
export function getPollingHandler(provider: string): PollingProviderHandler | undefined {
  return POLLING_HANDLERS[provider]
}
