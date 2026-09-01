import { describe, expect, it } from 'vitest'
import { addCopilotChatResourceBodySchema } from '@/lib/api/contracts/copilot'
import {
  BROWSER_SESSION_RESOURCE_ID,
  canonicalizeDesktopSessionResource,
  isAddressableResource,
  isDesktopOnlyResource,
  isEphemeralResource,
  type MothershipResource,
  MothershipResourceType,
  mergeChatResource,
  mergePendingChatResourceUpdate,
  PERSISTED_RESOURCE_TYPES,
  reorderStoredChatResources,
  sanitizeChatResources,
  TERMINAL_SESSION_RESOURCE_ID,
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

describe('desktop session resource identity', () => {
  it('keeps browser pages as inner tabs of one canonical Browser resource', () => {
    expect(
      sanitizeChatResources([
        resource({
          type: 'browser',
          id: 'browser-session:slack-tab',
          title: 'mship-todo (Channel) - sim - Slack',
        }),
        resource({ type: 'browser', id: BROWSER_SESSION_RESOURCE_ID, title: 'Browser' }),
      ])
    ).toEqual([{ type: 'browser', id: BROWSER_SESSION_RESOURCE_ID, title: 'Browser' }])
  })

  it('canonicalizes terminal inner-tab metadata without changing regular resources', () => {
    expect(
      canonicalizeDesktopSessionResource(
        resource({ type: 'terminal', id: 'terminal-session:2', title: 'zsh' })
      )
    ).toEqual({ type: 'terminal', id: TERMINAL_SESSION_RESOURCE_ID, title: 'Terminal' })

    const file = resource({ type: 'file', id: 'file-1', title: 'report.csv' })
    expect(canonicalizeDesktopSessionResource(file)).toBe(file)
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

  it('accepts an explicit table pin clear and rejects ambiguous or non-table clears', () => {
    expect(
      addCopilotChatResourceBodySchema.safeParse({
        chatId: 'chat-1',
        resource: { type: 'table', id: 'tbl-1', title: 'Invoices' },
        clearViewId: true,
      }).success
    ).toBe(true)
    expect(
      addCopilotChatResourceBodySchema.safeParse({
        chatId: 'chat-1',
        resource: { type: 'table', id: 'tbl-1', title: 'Invoices', viewId: 'view-1' },
        clearViewId: true,
      }).success
    ).toBe(false)
    expect(
      addCopilotChatResourceBodySchema.safeParse({
        chatId: 'chat-1',
        resource: { type: 'file', id: 'file-1', title: 'report.csv' },
        clearViewId: true,
      }).success
    ).toBe(false)
  })

  it('covers every resource type, so a new one has to make the choice explicitly', () => {
    const all = Object.values(MothershipResourceType)
    const ephemeral = all.filter((type) => isEphemeralResource(resource({ type })))
    expect([...PERSISTED_RESOURCE_TYPES, ...ephemeral].sort()).toEqual([...all].sort())
  })
})

describe('unaddressable resources', () => {
  it('recognizes a resource that points at nothing', () => {
    expect(isAddressableResource(resource({ id: '' }))).toBe(false)
    expect(isAddressableResource(resource({ id: '   ' }))).toBe(false)
    expect(isAddressableResource(resource({ id: 'file-1' }))).toBe(true)
  })

  it('drops a stored blank-id resource, which would otherwise 400 every send', () => {
    const stored = [
      resource({ id: '', title: 'reporte-russell.md' }),
      resource({ type: 'table', id: 'tbl_1', title: 'kb_agent_queries' }),
    ]
    expect(sanitizeChatResources(stored)).toEqual([
      { type: 'table', id: 'tbl_1', title: 'kb_agent_queries' },
    ])
  })

  it('keeps the desktop panels, which are given their ids by canonicalization', () => {
    const sanitized = sanitizeChatResources([
      resource({ type: 'browser', id: '', title: 'Browser' }),
      resource({ type: 'terminal', id: '', title: 'Terminal' }),
    ])
    expect(sanitized.map((r) => r.id)).toEqual([
      BROWSER_SESSION_RESOURCE_ID,
      TERMINAL_SESSION_RESOURCE_ID,
    ])
  })

  it('refuses a blank id at the write boundary, matching the send path', () => {
    const parsed = addCopilotChatResourceBodySchema.safeParse({
      chatId: 'chat-1',
      resource: { type: 'file', id: '', title: 'reporte-russell.md' },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('mergeChatResource', () => {
  const stored = resource({ type: 'table', id: 'tbl-1', title: 'Invoices' })

  it('adds a resource the chat does not have yet', () => {
    expect(mergeChatResource(undefined, stored)).toBe(stored)
  })

  it('keeps the stored entry when the newcomer changes nothing', () => {
    expect(mergeChatResource(stored, { ...stored })).toBe(stored)
  })

  it('replaces a placeholder title but never a specific one', () => {
    const placeholder = resource({ type: 'table', id: 'tbl-1', title: 'Table' })
    expect(mergeChatResource(placeholder, stored).title).toBe('Invoices')
    expect(mergeChatResource(stored, placeholder).title).toBe('Invoices')
  })

  it('moves the pin to the view the agent touched last and keeps it across unpinned re-adds', () => {
    const pinnedA = mergeChatResource(stored, { ...stored, viewId: 'view-a' })
    expect(pinnedA.viewId).toBe('view-a')

    const pinnedB = mergeChatResource(pinnedA, { ...stored, viewId: 'view-b' })
    expect(pinnedB.viewId).toBe('view-b')

    // A row edit re-adds the table without a view — the tab stays on view-b.
    expect(mergeChatResource(pinnedB, stored)).toBe(pinnedB)
  })

  it('clears a pin only when the update carries the explicit clear directive', () => {
    const pinned = { ...stored, viewId: 'view-a' }

    expect(mergeChatResource(pinned, { ...stored, clearViewId: true })).toEqual(stored)
    expect(mergeChatResource(undefined, { ...stored, clearViewId: true })).toEqual(stored)
  })
})

describe('mergeChatResource metadata', () => {
  it('takes the metadata a newcomer defines and keeps what it omits', () => {
    const placeholder = resource({ type: 'file', id: 'f1', title: 'File' })
    const upgraded = mergeChatResource(placeholder, {
      type: 'file',
      id: 'f1',
      title: 'notes.md',
      path: 'files/notes.md',
    })
    expect(upgraded).toEqual({ type: 'file', id: 'f1', title: 'notes.md', path: 'files/notes.md' })

    // A later re-add without a path keeps the stored one.
    expect(mergeChatResource(upgraded, { type: 'file', id: 'f1', title: 'notes.md' })).toBe(
      upgraded
    )

    const log = resource({ type: 'log', id: 'row-1', title: 'Run' })
    expect(
      mergeChatResource(log, { type: 'log', id: 'row-1', title: 'Run', executionId: 'exec-1' })
        .executionId
    ).toBe('exec-1')
  })
})

describe('mergePendingChatResourceUpdate', () => {
  const table = resource({ type: 'table', id: 'tbl-1', title: 'Invoices' })

  it('retains a pending clear across an unrelated update', () => {
    expect(mergePendingChatResourceUpdate({ ...table, clearViewId: true }, table)).toEqual({
      ...table,
      clearViewId: true,
    })
  })

  it('lets a newer explicit pin replace a pending clear', () => {
    expect(
      mergePendingChatResourceUpdate(
        { ...table, clearViewId: true },
        { ...table, viewId: 'view-new' }
      )
    ).toEqual({ ...table, viewId: 'view-new' })
  })
})

describe('reorderStoredChatResources', () => {
  const table = resource({
    type: 'table',
    id: 'tbl-1',
    title: 'Invoices',
    viewId: 'view-new',
  })
  const file = resource({ id: 'file-1', title: 'report.csv', path: 'files/report.csv' })

  it('uses the request only for order and preserves newer stored metadata', () => {
    expect(
      reorderStoredChatResources(
        [table, file],
        [
          { ...file, path: 'stale/report.csv' },
          { ...table, viewId: 'view-stale' },
        ]
      )
    ).toEqual([file, table])
  })

  it('rejects missing, extra, and duplicate identities', () => {
    expect(reorderStoredChatResources([table, file], [table])).toBeNull()
    expect(reorderStoredChatResources([table], [table, file])).toBeNull()
    expect(reorderStoredChatResources([table, file], [table, table])).toBeNull()
  })
})
