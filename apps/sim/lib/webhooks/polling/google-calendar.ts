import { pollingIdempotency } from '@/lib/core/idempotency/service'
import type { PollingProviderHandler, PollWebhookContext } from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  resolveOAuthCredential,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
const MAX_EVENTS_PER_POLL = 50
const MAX_PAGES = 10

type CalendarEventTypeFilter = '' | 'created' | 'updated' | 'cancelled'

interface GoogleCalendarWebhookConfig {
  calendarId?: string
  manualCalendarId?: string
  eventTypeFilter?: CalendarEventTypeFilter
  searchTerm?: string
  lastCheckedTimestamp?: string
  maxEventsPerPoll?: number
}

interface CalendarEventAttendee {
  email: string
  displayName?: string
  responseStatus?: string
  self?: boolean
  organizer?: boolean
}

interface CalendarEventPerson {
  email: string
  displayName?: string
  self?: boolean
}

interface CalendarEventTime {
  dateTime?: string
  date?: string
  timeZone?: string
}

interface CalendarEvent {
  id: string
  status: string
  htmlLink?: string
  created?: string
  updated?: string
  summary?: string
  description?: string
  location?: string
  start?: CalendarEventTime
  end?: CalendarEventTime
  attendees?: CalendarEventAttendee[]
  creator?: CalendarEventPerson
  organizer?: CalendarEventPerson
  recurringEventId?: string
}

interface SimplifiedCalendarEvent {
  id: string
  status: string
  eventType: 'created' | 'updated' | 'cancelled'
  summary: string | null
  eventDescription: string | null
  location: string | null
  htmlLink: string | null
  start: CalendarEventTime | null
  end: CalendarEventTime | null
  created: string | null
  updated: string | null
  attendees: CalendarEventAttendee[] | null
  creator: CalendarEventPerson | null
  organizer: CalendarEventPerson | null
}

export interface GoogleCalendarWebhookPayload {
  event: SimplifiedCalendarEvent
  calendarId: string
  timestamp: string
}

export const googleCalendarPollingHandler: PollingProviderHandler = {
  provider: 'google-calendar',
  label: 'Google Calendar',

  async pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const accessToken = await resolveOAuthCredential(
        webhookData,
        'google-calendar',
        requestId,
        logger
      )

      const config = webhookData.providerConfig as unknown as GoogleCalendarWebhookConfig
      const calendarId = config.calendarId || config.manualCalendarId || 'primary'

      // First poll: seed timestamp, emit nothing
      if (!config.lastCheckedTimestamp) {
        await updateWebhookProviderConfig(
          webhookId,
          { lastCheckedTimestamp: new Date().toISOString() },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(`[${requestId}] First poll for webhook ${webhookId}, seeded timestamp`)
        return 'success'
      }

      // Fetch changed events since last poll
      const events = await fetchChangedEvents(accessToken, calendarId, config, requestId, logger)

      if (!events.length) {
        await markWebhookSuccess(webhookId, logger)
        logger.info(`[${requestId}] No changed events for webhook ${webhookId}`)
        return 'success'
      }

      logger.info(`[${requestId}] Found ${events.length} changed events for webhook ${webhookId}`)

      const { processedCount, failedCount, latestUpdated } = await processEvents(
        events,
        calendarId,
        config.eventTypeFilter,
        webhookData,
        workflowData,
        requestId,
        logger
      )

      const newTimestamp =
        failedCount > 0
          ? config.lastCheckedTimestamp
          : latestUpdated
            ? new Date(new Date(latestUpdated).getTime() + 1).toISOString()
            : config.lastCheckedTimestamp
      await updateWebhookProviderConfig(webhookId, { lastCheckedTimestamp: newTimestamp }, logger)

      if (failedCount > 0 && processedCount === 0) {
        await markWebhookFailed(webhookId, logger)
        logger.warn(
          `[${requestId}] All ${failedCount} events failed to process for webhook ${webhookId}`
        )
        return 'failure'
      }

      await markWebhookSuccess(webhookId, logger)
      logger.info(
        `[${requestId}] Successfully processed ${processedCount} events for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      )
      return 'success'
    } catch (error) {
      logger.error(`[${requestId}] Error processing Google Calendar webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

async function fetchChangedEvents(
  accessToken: string,
  calendarId: string,
  config: GoogleCalendarWebhookConfig,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<CalendarEvent[]> {
  const allEvents: CalendarEvent[] = []
  const maxEvents = config.maxEventsPerPoll || MAX_EVENTS_PER_POLL
  let pageToken: string | undefined
  let pages = 0

  do {
    pages++
    const params = new URLSearchParams({
      updatedMin: config.lastCheckedTimestamp!,
      singleEvents: 'true',
      showDeleted: 'true',
      orderBy: 'updated',
      maxResults: String(Math.min(maxEvents, 250)),
    })

    if (pageToken) {
      params.set('pageToken', pageToken)
    }

    if (config.searchTerm) {
      params.set('q', config.searchTerm)
    }

    const encodedCalendarId = encodeURIComponent(calendarId)
    const url = `${CALENDAR_API_BASE}/calendars/${encodedCalendarId}/events?${params.toString()}`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const status = response.status
      const errorData = await response.json().catch(() => ({}))

      if (status === 403 || status === 429) {
        throw new Error(
          `Calendar API rate limit (${status}) — skipping to retry next poll cycle: ${JSON.stringify(errorData)}`
        )
      }

      throw new Error(`Failed to fetch calendar events: ${status} - ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    const events = (data.items || []) as CalendarEvent[]
    allEvents.push(...events)

    pageToken = data.nextPageToken as string | undefined

    // Stop if we have enough events or hit the page limit
    if (allEvents.length >= maxEvents || pages >= MAX_PAGES) {
      break
    }
  } while (pageToken)

  return allEvents.slice(0, maxEvents)
}

function determineEventType(event: CalendarEvent): 'created' | 'updated' | 'cancelled' {
  if (event.status === 'cancelled') {
    return 'cancelled'
  }

  // If created and updated are within 5 seconds, treat as newly created
  if (event.created && event.updated) {
    const createdTime = new Date(event.created).getTime()
    const updatedTime = new Date(event.updated).getTime()
    if (Math.abs(updatedTime - createdTime) < 5000) {
      return 'created'
    }
  }

  return 'updated'
}

function simplifyEvent(
  event: CalendarEvent,
  eventType?: 'created' | 'updated' | 'cancelled'
): SimplifiedCalendarEvent {
  return {
    id: event.id,
    status: event.status,
    eventType: eventType ?? determineEventType(event),
    summary: event.summary ?? null,
    eventDescription: event.description ?? null,
    location: event.location ?? null,
    htmlLink: event.htmlLink ?? null,
    start: event.start ?? null,
    end: event.end ?? null,
    created: event.created ?? null,
    updated: event.updated ?? null,
    attendees: event.attendees ?? null,
    creator: event.creator ?? null,
    organizer: event.organizer ?? null,
  }
}

async function processEvents(
  events: CalendarEvent[],
  calendarId: string,
  eventTypeFilter: CalendarEventTypeFilter | undefined,
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ processedCount: number; failedCount: number; latestUpdated: string | null }> {
  let processedCount = 0
  let failedCount = 0
  let latestUpdated: string | null = null

  for (const event of events) {
    // Track the latest `updated` timestamp for clock-skew-free state tracking
    if (event.updated) {
      if (!latestUpdated || event.updated > latestUpdated) {
        latestUpdated = event.updated
      }
    }

    // Client-side event type filter — skip before idempotency so filtered events aren't cached
    const computedEventType = determineEventType(event)
    if (eventTypeFilter && computedEventType !== eventTypeFilter) {
      continue
    }

    try {
      // Idempotency key includes `updated` so re-edits of the same event re-trigger
      const idempotencyKey = `${webhookData.id}:${event.id}:${event.updated || event.created || ''}`

      await pollingIdempotency.executeWithIdempotency(
        'google-calendar',
        idempotencyKey,
        async () => {
          const simplified = simplifyEvent(event, computedEventType)

          const payload: GoogleCalendarWebhookPayload = {
            event: simplified,
            calendarId,
            timestamp: new Date().toISOString(),
          }

          const result = await processPolledWebhookEvent(
            webhookData,
            workflowData,
            payload,
            requestId
          )

          if (!result.success) {
            logger.error(
              `[${requestId}] Failed to process webhook for event ${event.id}:`,
              result.statusCode,
              result.error
            )
            throw new Error(`Webhook processing failed (${result.statusCode}): ${result.error}`)
          }

          return { eventId: event.id, processed: true }
        }
      )

      logger.info(
        `[${requestId}] Successfully processed event ${event.id} for webhook ${webhookData.id}`
      )
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error processing event ${event.id}:`, errorMessage)
      failedCount++
    }
  }

  return { processedCount, failedCount, latestUpdated }
}
