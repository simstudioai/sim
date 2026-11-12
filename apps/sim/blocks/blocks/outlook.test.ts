import { describe, expect, it, vi } from 'vitest'
import { OutlookBlock } from './outlook'

/**
 * Only this service's configs are needed; the full registry is ~6,000 modules.
 * Registration is asserted through the generated `@/tools/tool-ids`.
 */
vi.mock('@/tools/registry', async () => {
  const { partialToolRegistry } = await import('@sim/testing/mocks/tool-registry.mock')
  return { tools: partialToolRegistry(await import('@/tools/outlook')) }
})

const block = OutlookBlock

/** Representative values for every calendar subBlock, as the editor would supply them. */
const CALENDAR_SUBBLOCK_VALUES: Record<string, unknown> = {
  oauthCredential: 'cred-1',
  calendarId: 'cal-1',
  calEventId: 'evt-1',
  calWindowStart: '2025-06-03T00:00:00Z',
  calWindowEnd: '2025-06-10T00:00:00Z',
  calMaxResults: '25',
  calOrderBy: 'start/dateTime',
  calPageToken: '',
  calSubject: 'Sync',
  calStartDateTime: '2025-06-03T10:00:00Z',
  calEndDateTime: '2025-06-03T11:00:00Z',
  calBody: 'agenda',
  calContentType: 'text',
  calLocation: 'Room 1',
  calAttendees: 'a@x.com',
  calTimeZone: 'America/Los_Angeles',
  calIsAllDay: false,
  calIsOnlineMeeting: true,
  calResponseType: 'accept',
  calComment: 'see you',
  calSendResponse: 'true',
}

describe('OutlookBlock calendar operations', () => {
  it('always sends sendResponse so an unset dropdown cannot read as "do not notify"', () => {
    const withoutChoice = block.tools.config.params?.({
      operation: 'respond_calendar',
      ...CALENDAR_SUBBLOCK_VALUES,
      calSendResponse: undefined,
    })
    expect(withoutChoice?.sendResponse).toBe(true)

    const declined = block.tools.config.params?.({
      operation: 'respond_calendar',
      ...CALENDAR_SUBBLOCK_VALUES,
      calSendResponse: 'false',
    })
    expect(declined?.sendResponse).toBe(false)
  })
})

/**
 * The executor builds tool params as `{ ...inputs, ...transformedParams }`, so a value stored for
 * another operation reaches the tool unless the mapper assigns that key explicitly.
 */
describe('OutlookBlock values stored for another operation', () => {
  const mapParams = block.tools.config?.params as (
    params: Record<string, unknown>
  ) => Record<string, unknown>

  it.each(['reply_outlook', 'reply_all_outlook', 'forward_outlook'])(
    'clears a Send cc/bcc on %s',
    (operation) => {
      const mapped = mapParams({
        operation,
        oauthCredential: 'cred-1',
        messageId: 'msg-1',
        cc: 'boss@example.com',
        bcc: 'audit@example.com',
      })
      expect(mapped).toHaveProperty('cc', null)
      expect(mapped).toHaveProperty('bcc', null)
    }
  )

  it.each(['reply_outlook', 'reply_all_outlook', 'forward_outlook'])(
    'clears an Update Message importance on %s',
    (operation) => {
      const mapped = mapParams({ operation, oauthCredential: 'cred-1', importance: 'high' })
      expect(mapped).toHaveProperty('importance', undefined)
    }
  )

  it('clears an Update Message importance on send and draft', () => {
    for (const operation of ['send_outlook', 'draft_outlook']) {
      const mapped = mapParams({ operation, oauthCredential: 'cred-1', importance: 'high' })
      expect(mapped).toHaveProperty('importance', null)
    }
  })
})
