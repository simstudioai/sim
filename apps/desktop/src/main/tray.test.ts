import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { nativeImage, session } from 'electron'
import {
  addTrayEnvironmentSubscript,
  buildTrayMenuTemplate,
  chatRoute,
  installTray,
  parseRecentChats,
  type RecentChat,
  type TrayDeps,
  trayEnvironmentMarker,
} from '@/main/tray'
// Same module instance the vi.mock factory returns, with mock-typed statics.
import { Menu, Tray } from '@/test/electron-mock'

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
})

describe('tray environment marker', () => {
  it('marks only non-production channels', () => {
    expect(trayEnvironmentMarker('prod')).toBeNull()
    expect(trayEnvironmentMarker('local')).toBe('L')
    expect(trayEnvironmentMarker('dev')).toBe('D')
    expect(trayEnvironmentMarker('staging')).toBe('S')
  })

  it('adds a larger antialiased subscript without modifying the source icon', () => {
    const source = nativeImage.createFromPath('/tmp/simTemplate.png')
    const marked = addTrayEnvironmentSubscript(source, 'D')

    expect(marked).not.toBe(source)
    const [bitmap, options] = vi.mocked(nativeImage.createFromBitmap).mock.calls.at(-1) ?? []
    expect(options).toEqual({ width: 76, height: 32, scaleFactor: 2 })
    expect(Buffer.isBuffer(bitmap)).toBe(true)
    expect((bitmap as Buffer).some((value) => value === 255)).toBe(true)
    expect((bitmap as Buffer).some((value) => value > 0 && value < 255)).toBe(true)
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
      'Recent Chats',
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
    expect(empty.some((item) => item.label === 'Recent Chats')).toBe(false)
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
    vi.mocked(nativeImage.createFromBitmap).mockClear()
    Menu.buildFromTemplate.mockClear()
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

  it('drops the previous user’s chats when the server says signed out', async () => {
    // A 401 is an answer ("no user, no chats"), not a transport failure. If it
    // were treated as a failure the menu would keep listing the signed-out
    // user's chat titles to whoever picks the machine up next.
    let signedIn = true
    const fetchMock = vi.fn(async () =>
      signedIn
        ? {
            ok: true,
            status: 200,
            json: async () => ({ chats: [{ id: 'c1', title: 'Secret', workspaceId: 'ws1' }] }),
          }
        : { ok: false, status: 401, json: async () => ({}) }
    )
    vi.mocked(session.fromPartition).mockReturnValue({ fetch: fetchMock } as never)

    installTray(makeDeps())
    const tray = Tray.instances[0]
    const clickHandler = tray.on.mock.calls.find(
      ([event]: unknown[]) => event === 'click'
    )?.[1] as () => void

    // Each click pops from cache then refreshes it, so poll until the menu
    // settles rather than assuming which click sees the new state.
    const lastMenu = () => JSON.stringify(Menu.buildFromTemplate.mock.calls.at(-1))
    await vi.waitFor(() => {
      clickHandler()
      expect(lastMenu()).toContain('Secret')
    })

    signedIn = false
    await vi.waitFor(() => {
      clickHandler()
      expect(lastMenu()).not.toContain('Secret')
    })
    expect(tray.popUpContextMenu).toHaveBeenCalled()
  })

  it('clearRecentChats empties the menu immediately and voids an in-flight fetch', async () => {
    // Sign-out teardown calls this. The menu pops from cache BEFORE refreshing,
    // so without it the next open would show the old titles one more time.
    let release: (value: unknown) => void = () => {}
    const inFlight = new Promise((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn(async () => {
      await inFlight
      return {
        ok: true,
        status: 200,
        json: async () => ({ chats: [{ id: 'c1', title: 'Secret', workspaceId: 'ws1' }] }),
      }
    })
    vi.mocked(session.fromPartition).mockReturnValue({ fetch: fetchMock } as never)

    const handle = installTray(makeDeps())
    handle?.clearRecentChats()
    release(undefined)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const tray = Tray.instances[0]
    const clickHandler = tray.on.mock.calls.find(
      ([event]: unknown[]) => event === 'click'
    )?.[1] as () => void
    clickHandler()
    await vi.waitFor(() => expect(tray.popUpContextMenu).toHaveBeenCalled())
    expect(JSON.stringify(Menu.buildFromTemplate.mock.calls.at(-1))).not.toContain('Secret')
  })

  it('marks dev, staging, and local status items while leaving production unchanged', () => {
    vi.mocked(session.fromPartition).mockReturnValue({
      fetch: vi.fn(async () => {
        throw new Error('offline')
      }),
    } as never)

    installTray(makeDeps())
    expect(nativeImage.createFromBitmap).not.toHaveBeenCalled()
    expect(Tray.instances.at(-1)?.setToolTip).toHaveBeenCalledWith('Sim')

    installTray(makeDeps({ appOrigin: () => 'https://dev.sim.ai' }))
    expect(nativeImage.createFromBitmap).toHaveBeenCalledTimes(1)
    expect(Tray.instances.at(-1)?.setToolTip).toHaveBeenCalledWith('Sim Dev')

    installTray(makeDeps({ appOrigin: () => 'https://staging.sim.ai' }))
    expect(nativeImage.createFromBitmap).toHaveBeenCalledTimes(2)
    expect(Tray.instances.at(-1)?.setToolTip).toHaveBeenCalledWith('Sim Staging')

    installTray(makeDeps({ appOrigin: () => 'http://localhost:3000' }))
    expect(nativeImage.createFromBitmap).toHaveBeenCalledTimes(3)
    expect(Tray.instances.at(-1)?.setToolTip).toHaveBeenCalledWith('Sim Local')
  })
})
