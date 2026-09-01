/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createEventInviteeTool } from '@/tools/calendly/create_event_invitee'
import { createInviteeNoShowTool } from '@/tools/calendly/create_invitee_no_show'
import { createWebhookTool } from '@/tools/calendly/create_webhook'
import { getEventInviteeTool } from '@/tools/calendly/get_event_invitee'
import { listEventTypesTool } from '@/tools/calendly/list_event_types'
import { listScheduledEventsTool } from '@/tools/calendly/list_scheduled_events'
import { listWebhooksTool } from '@/tools/calendly/list_webhooks'
import { toResourceUri, toStringArray, toUuid } from '@/tools/calendly/utils'

function buildUrl(tool: { request: { url: unknown } }, params: Record<string, unknown>): string {
  const url = tool.request.url
  return typeof url === 'function' ? url(params) : (url as string)
}

function buildBody(tool: { request: { body?: unknown } }, params: Record<string, unknown>) {
  const body = tool.request.body as (p: Record<string, unknown>) => Record<string, unknown>
  return body(params)
}

describe('calendly resource identifiers', () => {
  it('extracts the trailing uuid from a nested invitee uri', () => {
    expect(toUuid('https://api.calendly.com/scheduled_events/event-1/invitees/invitee-2')).toBe(
      'invitee-2'
    )
  })

  it('leaves a bare uuid untouched and strips surrounding whitespace', () => {
    expect(toUuid('  event-1  ')).toBe('event-1')
  })

  it('expands a bare uuid into a canonical uri and passes a full uri through', () => {
    expect(toResourceUri(' user-1 ', 'users')).toBe('https://api.calendly.com/users/user-1')
    expect(toResourceUri('https://api.calendly.com/users/user-1', 'users')).toBe(
      'https://api.calendly.com/users/user-1'
    )
  })

  it('accepts json array params as both an array and a json string', () => {
    expect(toStringArray(['a@example.com'], 'eventGuests')).toEqual(['a@example.com'])
    expect(toStringArray('["a@example.com"]', 'eventGuests')).toEqual(['a@example.com'])
    expect(toStringArray(undefined, 'eventGuests')).toEqual([])
  })

  it('rejects a json array param that is not an array', () => {
    expect(() => toStringArray('{"a":1}', 'eventGuests')).toThrow(/array of strings/)
    expect(() => toStringArray('not json', 'eventGuests')).toThrow(/Invalid JSON input/)
  })
})

describe('calendly list tools', () => {
  it('always sends the scope required by the webhook subscriptions endpoint', () => {
    const url = buildUrl(listWebhooksTool, {
      apiKey: 'k',
      organization: 'org-1',
      scope: 'organization',
    })

    expect(url).toContain('scope=organization')
    expect(url).toContain(
      `organization=${encodeURIComponent('https://api.calendly.com/organizations/org-1')}`
    )
  })

  it('sends active=false so inactive event types can be listed', () => {
    expect(buildUrl(listEventTypesTool, { apiKey: 'k', user: 'user-1', active: false })).toContain(
      'active=false'
    )
    expect(buildUrl(listEventTypesTool, { apiKey: 'k', user: 'user-1', active: true })).toContain(
      'active=true'
    )
  })

  it('omits the active filter entirely when it is not set', () => {
    expect(buildUrl(listEventTypesTool, { apiKey: 'k', user: 'user-1' })).not.toContain('active=')
  })

  it('normalizes bare uuids for the shared user and organization filters', () => {
    const url = buildUrl(listScheduledEventsTool, { apiKey: 'k', user: 'user-1' })
    expect(url).toContain(`user=${encodeURIComponent('https://api.calendly.com/users/user-1')}`)
  })

  it('still requires a user or organization scope', () => {
    expect(() => buildUrl(listScheduledEventsTool, { apiKey: 'k' })).toThrow(
      /"user" or "organization"/
    )
  })
})

describe('calendly booking', () => {
  const bookingParams = {
    apiKey: 'k',
    eventTypeUri: 'event-type-1',
    startTime: '2024-01-15T09:00:00Z',
    inviteeEmail: 'invitee@example.com',
    inviteeTimezone: 'America/New_York',
    inviteeName: 'Jane Doe',
  }

  it('builds the documented booking body', () => {
    expect(buildBody(createEventInviteeTool, bookingParams)).toEqual({
      event_type: 'https://api.calendly.com/event_types/event-type-1',
      start_time: '2024-01-15T09:00:00Z',
      invitee: {
        email: 'invitee@example.com',
        timezone: 'America/New_York',
        name: 'Jane Doe',
      },
    })
  })

  it('accepts event guests supplied as a json string', () => {
    const body = buildBody(createEventInviteeTool, {
      ...bookingParams,
      eventGuests: '["guest@example.com"]',
    })

    expect(body.event_guests).toEqual(['guest@example.com'])
  })

  it('rejects a booking with neither a full name nor a first name', () => {
    const { inviteeName, ...withoutName } = bookingParams
    expect(() => buildBody(createEventInviteeTool, withoutName)).toThrow(
      /"inviteeName" or "inviteeFirstName"/
    )
  })

  it('trims the invitee uri when marking a no-show', () => {
    expect(
      buildBody(createInviteeNoShowTool, {
        apiKey: 'k',
        inviteeUri: '  https://api.calendly.com/scheduled_events/e-1/invitees/i-1  ',
      })
    ).toEqual({ invitee: 'https://api.calendly.com/scheduled_events/e-1/invitees/i-1' })
  })

  it('addresses a single invitee by its event and invitee uuids', () => {
    expect(
      buildUrl(getEventInviteeTool, {
        apiKey: 'k',
        eventUuid: 'https://api.calendly.com/scheduled_events/e-1',
        inviteeUuid: 'i-1',
      })
    ).toBe('https://api.calendly.com/scheduled_events/e-1/invitees/i-1')
  })
})

describe('calendly webhook subscriptions', () => {
  it('normalizes the organization and user identifiers when creating a webhook', () => {
    expect(
      buildBody(createWebhookTool, {
        apiKey: 'k',
        url: 'https://example.com/hook',
        events: ['invitee.created'],
        organization: 'org-1',
        scope: 'user',
        user: 'user-1',
      })
    ).toEqual({
      url: 'https://example.com/hook',
      events: ['invitee.created'],
      organization: 'https://api.calendly.com/organizations/org-1',
      scope: 'user',
      user: 'https://api.calendly.com/users/user-1',
    })
  })

  it('accepts webhook events supplied as a json string', () => {
    const body = buildBody(createWebhookTool, {
      apiKey: 'k',
      url: 'https://example.com/hook',
      events: '["invitee.created","invitee.canceled"]',
      organization: 'https://api.calendly.com/organizations/org-1',
      scope: 'organization',
    })

    expect(body.events).toEqual(['invitee.created', 'invitee.canceled'])
  })
})
