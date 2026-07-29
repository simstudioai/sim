/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tools as toolRegistry } from '@/tools/registry'
import { OutlookBlock } from './outlook'

const block = OutlookBlock

/** Every calendar operation exposed by the block's operation dropdown. */
const CALENDAR_OPERATIONS = [
  'list_events_calendar',
  'get_event_calendar',
  'create_event_calendar',
  'update_event_calendar',
  'delete_event_calendar',
  'respond_calendar',
] as const

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
  it.each(CALENDAR_OPERATIONS)('%s resolves to a registered tool in tools.access', (operation) => {
    const toolId = block.tools.config.tool?.({ operation }) as string
    expect(toolRegistry[toolId]).toBeDefined()
    expect(block.tools.access).toContain(toolId)
  })

  it.each(CALENDAR_OPERATIONS)('%s supplies every required tool param', (operation) => {
    const toolId = block.tools.config.tool?.({ operation }) as string
    const mapped = block.tools.config.params?.({ operation, ...CALENDAR_SUBBLOCK_VALUES }) ?? {}
    const required = Object.entries(toolRegistry[toolId].params ?? {})
      .filter(([id, config]) => config.required && id !== 'accessToken')
      .map(([id]) => id)

    const missing = required.filter((id) => mapped[id] === undefined || mapped[id] === '')
    expect(missing).toEqual([])
  })

  it.each(CALENDAR_OPERATIONS)('%s emits no params the tool cannot accept', (operation) => {
    const toolId = block.tools.config.tool?.({ operation }) as string
    const mapped = block.tools.config.params?.({ operation, ...CALENDAR_SUBBLOCK_VALUES }) ?? {}
    // `operation` and the credential ride along for the executor, not the tool contract.
    const accepted = new Set([
      ...Object.keys(toolRegistry[toolId].params ?? {}),
      'operation',
      'oauthCredential',
    ])

    const orphans = Object.keys(mapped).filter(
      (key) => !accepted.has(key) && mapped[key] !== undefined
    )
    expect(orphans).toEqual([])
  })

  it('maps calendar operations onto calendar tools one-to-one', () => {
    const reachable = CALENDAR_OPERATIONS.map(
      (operation) => block.tools.config.tool?.({ operation }) as string
    )
    const declared = block.tools.access.filter((id) => id.startsWith('outlook_calendar_'))
    // No calendar tool is declared but unreachable, and none is reached twice.
    expect([...reachable].sort()).toEqual([...declared].sort())
    expect(new Set(reachable).size).toBe(reachable.length)
  })

  it('routes the calendar picker through the calendarId canonical param', () => {
    const members = block.subBlocks.filter((s) => s.canonicalParamId === 'calendarId')
    expect(members.map((s) => s.id).sort()).toEqual(['calendarSelector', 'manualCalendarId'])
    // Exactly one basic-mode member, per the canonical-group contract.
    expect(members.filter((s) => s.mode === 'basic')).toHaveLength(1)
    // canonicalParamId must never collide with a subBlock id.
    expect(block.subBlocks.some((s) => s.id === 'calendarId')).toBe(false)
    // A blank pick means "default calendar", so it must not be forwarded.
    const mapped = block.tools.config.params?.({
      operation: 'create_event_calendar',
      ...CALENDAR_SUBBLOCK_VALUES,
      calendarId: '   ',
    })
    expect(mapped?.calendarId).toBeUndefined()
  })

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
