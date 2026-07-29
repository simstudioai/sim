import { describe, expect, it } from 'vitest'
import { addCopilotChatResourceBodySchema } from '@/lib/api/contracts/copilot'
import {
  BROWSER_SESSION_RESOURCE_ID,
  isDesktopOnlyResource,
  isEphemeralResource,
  type MothershipResource,
  MothershipResourceType,
  PERSISTED_RESOURCE_TYPES,
  parseTableViewResourceId,
  TERMINAL_SESSION_RESOURCE_ID,
  tableViewResourceId,
} from './types'

function resource(overrides: Partial<MothershipResource> = {}): MothershipResource {
  return { type: 'file', id: 'r1', title: 'Thing', ...overrides }
}

describe('isEphemeralResource', () => {
  it('persists the desktop panels so their tabs survive reopening the chat', () => {
    expect(
      isEphemeralResource(
        resource({ type: 'browser', id: BROWSER_SESSION_RESOURCE_ID, title: 'Browser' })
      )
    ).toBe(false)
    expect(
      isEphemeralResource(
        resource({ type: 'terminal', id: TERMINAL_SESSION_RESOURCE_ID, title: 'Terminal' })
      )
    ).toBe(false)
  })

  it('keeps synthetic panels client-only', () => {
    expect(isEphemeralResource(resource({ type: 'generic', id: 'results' }))).toBe(true)
    expect(isEphemeralResource(resource({ type: 'file', id: 'streaming-file' }))).toBe(true)
  })

  it('treats an unrecognized type as ephemeral rather than trying a doomed write', () => {
    expect(isEphemeralResource(resource({ type: 'nonsense' as MothershipResourceType }))).toBe(true)
  })
})

describe('View resource ids', () => {
  it('round-trips the source Table and View ids', () => {
    const resourceId = tableViewResourceId('tbl_1', 'view_1')
    expect(resourceId).toBe('tbl_1:view_1')
    expect(parseTableViewResourceId(resourceId)).toEqual({
      tableId: 'tbl_1',
      viewId: 'view_1',
    })
  })

  it('rejects malformed persisted View resource ids', () => {
    expect(parseTableViewResourceId('view_1')).toBeNull()
    expect(parseTableViewResourceId(':view_1')).toBeNull()
    expect(parseTableViewResourceId('tbl_1:')).toBeNull()
  })
})

describe('isDesktopOnlyResource', () => {
  it('marks the panels that need the desktop bridge', () => {
    expect(isDesktopOnlyResource(resource({ type: 'browser' }))).toBe(true)
    expect(isDesktopOnlyResource(resource({ type: 'terminal' }))).toBe(true)
  })

  it('leaves ordinary workspace resources alone', () => {
    expect(isDesktopOnlyResource(resource({ type: 'workflow' }))).toBe(false)
    expect(isDesktopOnlyResource(resource({ type: 'file' }))).toBe(false)
  })
})

/**
 * The bug this guards against: the client decided what to persist from one
 * list and the API validated against another, so `browser`, `task` and
 * `integration` were openable but unsaveable — every write 400'd into a
 * warning log and the tabs were gone on reload. Both sides now come from
 * `PERSISTED_RESOURCE_TYPES`; these fail if anything reintroduces a second
 * list.
 */
describe('client and server agree on what can be persisted', () => {
  it.each(PERSISTED_RESOURCE_TYPES)('the API accepts a %s resource', (type) => {
    const parsed = addCopilotChatResourceBodySchema.safeParse({
      chatId: 'chat-1',
      resource: { type, id: 'r1', title: 'Thing' },
    })
    expect(parsed.success).toBe(true)
  })

  it('the API rejects every type the client refuses to send', () => {
    const ephemeral = Object.values(MothershipResourceType).filter((type) =>
      isEphemeralResource(resource({ type }))
    )
    expect(ephemeral.length).toBeGreaterThan(0)
    for (const type of ephemeral) {
      const parsed = addCopilotChatResourceBodySchema.safeParse({
        chatId: 'chat-1',
        resource: { type, id: 'r1', title: 'Thing' },
      })
      expect(parsed.success, `expected the API to reject ${type}`).toBe(false)
    }
  })

  it('covers every resource type, so a new one has to make the choice explicitly', () => {
    const all = Object.values(MothershipResourceType)
    const ephemeral = all.filter((type) => isEphemeralResource(resource({ type })))
    expect([...PERSISTED_RESOURCE_TYPES, ...ephemeral].sort()).toEqual([...all].sort())
  })
})
