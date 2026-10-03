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
  return { id: `c${id}`, title: `Chat ${id}`, workspaceId: 'ws1', status: 'none' }
}

describe('parseRecentChats', () => {
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
    expect(JSON.stringify(tray.setContextMenu.mock.calls.at(-1)?.[0])).not.toContain('Secret')
  })
})
