import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { nativeImage, session } from 'electron'
import { installTray, parseRecentChats, type RecentChat, type TrayDeps } from '@/main/tray'
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

function _chat(id: number): RecentChat {
  return { id: `c${id}`, title: `Chat ${id}`, route: `/o/org1/chat/c${id}`, status: 'none' }
}

/** Answers the surface read with `org1` and the chat list with `chats`. */
function respond(chats: unknown[]) {
  return (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.includes('/api/organizations/surface')
        ? { organization: { id: 'org1' } }
        : { success: true, data: chats },
  })
}

describe('parseRecentChats', () => {
  it('derives the sidebar status semantics: active > unread > none', () => {
    const payload = {
      data: [
        // Streaming right now → active, regardless of seen state.
        {
          id: 'c1',
          title: 'Streaming',
          activeStreamId: 's1',
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: '2026-07-19T11:00:00Z',
        },
        // Finished after last seen → unread.
        {
          id: 'c2',
          title: 'Fresh reply',
          activeStreamId: null,
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: '2026-07-19T09:00:00Z',
        },
        // Never opened → unread.
        {
          id: 'c3',
          title: 'Never seen',
          activeStreamId: null,
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: null,
        },
        // Seen since the last update → no dot.
        {
          id: 'c4',
          title: 'Caught up',
          activeStreamId: null,
          updatedAt: '2026-07-19T10:00:00Z',
          lastSeenAt: '2026-07-19T11:00:00Z',
        },
        // Legacy row without the status fields → no dot.
        { id: 'c5', title: 'Legacy' },
      ],
    }
    expect(parseRecentChats(payload, 'org1').map((chat) => chat.status)).toEqual([
      'active',
      'unread',
      'unread',
      'none',
      'none',
    ])
  })
})

describe('parseRecentChats routes', () => {
  it('opens each organization chat at its page: Search for an assistant chat, Chat otherwise', () => {
    const payload = {
      success: true,
      data: [
        { id: 'c1', title: 'Build', mode: 'agent' },
        { id: 'c2', title: 'Ask', mode: 'assistant' },
      ],
    }
    expect(parseRecentChats(payload, 'org1').map((chat) => chat.route)).toEqual([
      '/o/org1/chat/c1',
      '/o/org1/search/chat/c2',
    ])
  })
})

describe('installTray', () => {
  beforeEach(() => {
    Tray.instances.length = 0
    vi.mocked(nativeImage.createFromBitmap).mockClear()
    Menu.buildFromTemplate.mockClear()
  })

  it('drops the previous user’s chats when the server says signed out', async () => {
    // A 401 is an answer ("no user, no chats"), not a transport failure. If it
    // were treated as a failure the menu would keep listing the signed-out
    // user's chat titles to whoever picks the machine up next.
    let signedIn = true
    const fetchMock = vi.fn(async (url: string) =>
      signedIn
        ? respond([{ id: 'c1', title: 'Secret', mode: 'agent' }])(url)
        : { ok: false, status: 401, json: async () => ({}) }
    )
    vi.mocked(session.fromPartition).mockReturnValue({ fetch: fetchMock } as never)
    vi.useFakeTimers()

    const handle = installTray(makeDeps())
    try {
      const tray = Tray.instances[0]
      await vi.advanceTimersByTimeAsync(0)
      const lastMenu = () => JSON.stringify(tray.setContextMenu.mock.calls.at(-1)?.[0])
      expect(lastMenu()).toContain('Secret')

      signedIn = false
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastMenu()).not.toContain('Secret')
    } finally {
      handle?.destroy()
      vi.useRealTimers()
    }
  })

  it('clearRecentChats empties the menu immediately and voids an in-flight fetch', async () => {
    // Sign-out teardown calls this so the attached native menu cannot retain
    // the previous user's titles while an older request is still in flight.
    let release: (value: unknown) => void = () => {}
    const inFlight = new Promise((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn(async (url: string) => {
      await inFlight
      return respond([{ id: 'c1', title: 'Secret', mode: 'agent' }])(url)
    })
    vi.mocked(session.fromPartition).mockReturnValue({ fetch: fetchMock } as never)

    const handle = installTray(makeDeps())
    handle?.clearRecentChats()
    release(undefined)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const tray = Tray.instances[0]
    expect(JSON.stringify(tray.setContextMenu.mock.calls.at(-1)?.[0])).not.toContain('Secret')
  })
})
