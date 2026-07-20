import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { session } from 'electron'
import {
  buildTrayMenuTemplate,
  chatRoute,
  installTray,
  newChatRoute,
  parseRecentChats,
  type RecentChat,
  settingsRoute,
  type TrayDeps,
} from '@/main/tray'
// Same module instance the vi.mock factory returns, with mock-typed statics.
import { Tray } from '@/test/electron-mock'

function makeDeps(overrides: Partial<TrayDeps> = {}): TrayDeps {
  return {
    partition: () => 'persist:sim',
    appOrigin: () => 'https://sim.ai',
    lastRoute: () => '/workspace/ws1/home',
    openMainWindow: vi.fn(),
    ...overrides,
  }
}

function chat(id: number): RecentChat {
  return { id: `c${id}`, title: `Chat ${id}`, workspaceId: 'ws1', status: 'none' }
}

describe('parseRecentChats', () => {
  it('keeps only well-formed workspace chats, capped at the limit', () => {
    const payload = {
      chats: [
        { id: 'c1', title: 'Build a workflow', workspaceId: 'ws1' },
        { id: 'c2', title: '', workspaceId: 'ws1' },
        { id: 'c3', title: 'No workspace', workspaceId: null },
        { id: 42, title: 'Bad id', workspaceId: 'ws1' },
        { id: 'c4', title: 'Four', workspaceId: 'ws2' },
        { id: 'c5', title: 'Five', workspaceId: 'ws2' },
        { id: 'c6', title: 'Six', workspaceId: 'ws2' },
        { id: 'c7', title: 'Seven', workspaceId: 'ws2' },
      ],
    }
    const chats = parseRecentChats(payload, 5)
    expect(chats.map((chat) => chat.id)).toEqual(['c1', 'c2', 'c4', 'c5', 'c6'])
    expect(chats[1].title).toBe('Untitled chat')
  })

  it('returns empty for malformed payloads', () => {
    expect(parseRecentChats(null)).toEqual([])
    expect(parseRecentChats({})).toEqual([])
    expect(parseRecentChats({ chats: 'nope' })).toEqual([])
  })

  it('derives the sidebar status semantics: active > unread > none', () => {
    const payload = {
      chats: [
        // Streaming right now → active, regardless of seen state.
        {
          id: 'c1',
          title: 'Streaming',
          workspaceId: 'ws1',
          activeStreamId: 's1',
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: '2026-07-19T11:00:00Z',
        },
        // Finished after last seen → unread.
        {
          id: 'c2',
          title: 'Fresh reply',
          workspaceId: 'ws1',
          activeStreamId: null,
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: '2026-07-19T09:00:00Z',
        },
        // Never opened → unread.
        {
          id: 'c3',
          title: 'Never seen',
          workspaceId: 'ws1',
          activeStreamId: null,
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: null,
        },
        // Seen since the last update → no dot.
        {
          id: 'c4',
          title: 'Caught up',
          workspaceId: 'ws1',
          activeStreamId: null,
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: '2026-07-19T11:00:00Z',
        },
        // Legacy row without the status fields → no dot.
        { id: 'c5', title: 'Legacy', workspaceId: 'ws1' },
      ],
    }
    expect(parseRecentChats(payload).map((chat) => chat.status)).toEqual([
      'active',
      'unread',
      'unread',
      'none',
      'none',
    ])
  })
})

describe('routes', () => {
  it('deep-links chats into their workspace', () => {
    expect(chatRoute({ id: 'c1', title: 't', workspaceId: 'ws9', status: 'none' })).toBe(
      '/workspace/ws9/chat/c1'
    )
  })

  it('derives the new-chat route from the last workspace route', () => {
    expect(newChatRoute('/workspace/ws1/w/wf2')).toBe('/workspace/ws1/home')
    expect(newChatRoute('/workspace/ws1/home?resource=r1')).toBe('/workspace/ws1/home')
    expect(newChatRoute('/account')).toBe('/workspace')
    expect(newChatRoute(undefined)).toBe('/workspace')
    expect(newChatRoute('//evil.example')).toBe('/workspace')
  })

  it('derives the settings route from the last workspace route', () => {
    expect(settingsRoute('/workspace/ws1/w/wf2')).toBe('/workspace/ws1/settings')
    expect(settingsRoute('/account')).toBe('/workspace')
    expect(settingsRoute(undefined)).toBe('/workspace')
    expect(settingsRoute('//evil.example')).toBe('/workspace')
  })
})

describe('buildTrayMenuTemplate', () => {
  it('shows recents inline, then actions and quit', () => {
    const deps = makeDeps()
    const template = buildTrayMenuTemplate(deps, [
      { id: 'c1', title: 'Fix the sync', workspaceId: 'ws1', status: 'none' },
    ])
    const labels = template.map((item) => item.label ?? item.role ?? item.type)
    expect(labels).toEqual([
      'Recent',
      'Fix the sync',
      'separator',
      'New Chat',
      'Open Sim',
      'separator',
      'Quit Sim',
    ])

    const chatItem = template.find((item) => item.label === 'Fix the sync')
    ;(chatItem?.click as () => void)()
    expect(deps.openMainWindow).toHaveBeenCalledWith('/workspace/ws1/chat/c1')

    const newChat = template.find((item) => item.label === 'New Chat')
    ;(newChat?.click as () => void)()
    expect(deps.openMainWindow).toHaveBeenCalledWith('/workspace/ws1/home')

    // Quit is a plain item (role:'quit' would get a system icon on macOS 26).
    const quit = template.find((item) => item.label === 'Quit Sim')
    expect(quit?.role).toBeUndefined()
    ;(quit?.click as () => void)()
  })

  it('marks active and unread chats with a status dot icon', () => {
    const template = buildTrayMenuTemplate(makeDeps(), [
      { id: 'c1', title: 'Working', workspaceId: 'ws1', status: 'active' },
      { id: 'c2', title: 'Fresh', workspaceId: 'ws1', status: 'unread' },
      { id: 'c3', title: 'Seen', workspaceId: 'ws1', status: 'none' },
    ])
    const working = template.find((item) => item.label === 'Working')
    const fresh = template.find((item) => item.label === 'Fresh')
    const seen = template.find((item) => item.label === 'Seen')
    expect(working?.icon).toBeDefined()
    expect(fresh?.icon).toBeDefined()
    // Active (yellow) and unread (green) use distinct images; read chats get none.
    expect(working?.icon).not.toBe(fresh?.icon)
    expect(seen?.icon).toBeUndefined()
  })

  it('overflows chats beyond the inline count into a More submenu', () => {
    const deps = makeDeps()
    const chats = Array.from({ length: 9 }, (_, i) => chat(i + 1))
    const template = buildTrayMenuTemplate(deps, chats)

    const inlineLabels = template
      .filter((item) => item.label?.startsWith('Chat '))
      .map((item) => item.label)
    expect(inlineLabels).toEqual(['Chat 1', 'Chat 2', 'Chat 3', 'Chat 4', 'Chat 5'])

    const more = template.find((item) => item.label === 'More')
    expect(more).toBeDefined()
    const submenu = more?.submenu as { label?: string; click?: () => void }[]
    expect(submenu.map((item) => item.label)).toEqual(['Chat 6', 'Chat 7', 'Chat 8', 'Chat 9'])
    submenu[0].click?.()
    expect(deps.openMainWindow).toHaveBeenCalledWith('/workspace/ws1/chat/c6')
  })

  it('omits More when everything fits inline and recents when empty', () => {
    const fits = buildTrayMenuTemplate(makeDeps(), [chat(1), chat(2)])
    expect(fits.some((item) => item.label === 'More')).toBe(false)

    const empty = buildTrayMenuTemplate(makeDeps(), [])
    expect(empty.some((item) => item.label === 'Recent')).toBe(false)
    expect(empty.map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'New Chat',
      'Open Sim',
      'separator',
      'Quit Sim',
    ])
  })
})

describe('installTray', () => {
  beforeEach(() => {
    Tray.instances.length = 0
  })

  it('fetches fresh chats on click and pops the menu', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ chats: [{ id: 'c1', title: 'Hello', workspaceId: 'ws1' }] }),
    }))
    vi.mocked(session.fromPartition).mockReturnValue({ fetch: fetchMock } as never)

    const handle = installTray(makeDeps())
    expect(handle).not.toBeNull()
    expect(Tray.instances).toHaveLength(1)
    const tray = Tray.instances[0]

    const clickHandler = tray.on.mock.calls.find(
      ([event]: unknown[]) => event === 'click'
    )?.[1] as () => void
    clickHandler()
    await vi.waitFor(() => expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sim.ai/api/copilot/chats',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('still pops the menu when the chats fetch fails', async () => {
    vi.mocked(session.fromPartition).mockReturnValue({
      fetch: vi.fn(async () => {
        throw new Error('offline')
      }),
    } as never)

    installTray(makeDeps())
    const tray = Tray.instances[0]
    const clickHandler = tray.on.mock.calls.find(
      ([event]: unknown[]) => event === 'click'
    )?.[1] as () => void
    clickHandler()
    await vi.waitFor(() => expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1))
  })
})
