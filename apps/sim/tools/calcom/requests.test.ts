import { describe, expect, it } from 'vitest'
import { getBookingTool } from '@/tools/calcom/get_booking'
import { getEventTypeTool } from '@/tools/calcom/get_event_type'
import { getScheduleTool } from '@/tools/calcom/get_schedule'
import { listBookingsTool } from '@/tools/calcom/list_bookings'

describe('Cal.com path ids', () => {
  it('rejects a dot-segment event type id instead of retargeting the request', () => {
    const buildUrl = getEventTypeTool.request.url
    if (typeof buildUrl !== 'function') throw new Error('get_event_type must build its URL')
    const modelParams = JSON.parse('{"accessToken":"t","eventTypeId":".."}')
    expect(() => buildUrl(modelParams)).toThrow('path traversal')
  })

  it('rejects dot-segment booking and schedule ids', () => {
    const bookingUrl = getBookingTool.request.url
    const scheduleUrl = getScheduleTool.request.url
    if (typeof bookingUrl !== 'function' || typeof scheduleUrl !== 'function') {
      throw new Error('get_booking and get_schedule must build their URLs')
    }
    expect(() => bookingUrl({ accessToken: 't', bookingUid: '..' })).toThrow('path traversal')
    expect(() => scheduleUrl({ accessToken: 't', scheduleId: '..' })).toThrow('path traversal')
  })
})

describe('Cal.com list bookings query', () => {
  it('sends the attendee, time-range, and sort filters', () => {
    const buildUrl = listBookingsTool.request.url
    if (typeof buildUrl !== 'function') throw new Error('list_bookings must build its URL')
    const query = new URL(
      buildUrl({
        accessToken: 't',
        attendeeEmail: 'a+b@x.com',
        afterStart: '2026-01-01T00:00:00Z',
        beforeEnd: '2026-01-31T00:00:00Z',
        sortStart: 'asc',
      })
    ).searchParams
    expect(query.get('attendeeEmail')).toBe('a+b@x.com')
    expect(query.get('afterStart')).toBe('2026-01-01T00:00:00Z')
    expect(query.get('beforeEnd')).toBe('2026-01-31T00:00:00Z')
    expect(query.get('sortStart')).toBe('asc')
  })

  it('omits a blank limit and offset instead of sending take=null', () => {
    const buildUrl = listBookingsTool.request.url
    if (typeof buildUrl !== 'function') throw new Error('list_bookings must build its URL')
    const blank = JSON.parse('{"take":null,"skip":""}')
    const query = new URL(buildUrl({ accessToken: 't', ...blank })).searchParams
    expect(query.has('take')).toBe(false)
    expect(query.has('skip')).toBe(false)
  })
})
