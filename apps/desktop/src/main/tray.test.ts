import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { session } from 'electron'
// Same module instance the vi.mock factory returns, with mock-typed statics.
import { Tray } from '@/test/electron-mock'
import {
  buildTrayMenuTemplate,
  chatRoute,
  installTray,
  newChatRoute,
  parseRecentChats,
  type TrayDeps,
} from '@/main/tray'

function makeDeps(overrides: Partial<TrayDeps> = {}): TrayDeps {
  return {
    partition: () => 'persist:sim',
    appOrigin: () => 'https://sim.ai',
    lastRoute: () => '/workspace/ws1/home',
    launcherShortcut: () => 'Alt+Space',
    openMainWindow: vi.fn(),
    toggleLauncher: vi.fn(),
    openSettings: vi.fn(),
    checkForUpdates: vi.fn(),
    ...overrides,
  }
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
    const chats = parseRecentChats(payload)
    expect(chats.map((chat) => chat.id)).toEqual(['c1', 'c2', 'c4', 'c5', 'c6'])
    expect(chats[1].title).toBe('Untitled chat')
  })

  it('returns empty for malformed payloads', () => {
    expect(parseRecentChats(null)).toEqual([])
    expect(parseRecentChats({})).toEqual([])
    expect(parseRecentChats({ chats: 'nope' })).toEqual([])
  })
})

describe('routes', () => {
  it('derives the new-chat route from the last workspace route', () => {
    expect(newChatRoute('/workspace/ws1/w/wf2')).toBe('/workspace/ws1/home')
    expect(newChatRoute('/workspace/ws1/home?resource=r1')).toBe('/workspace/ws1/home')
    expect(newChatRoute('/account')).toBe('/workspace')
    expect(newChatRoute(undefined)).toBe('/workspace')
    expect(newChatRoute('//evil.example')).toBe('/workspace')
  })

  it('deep-links chats into their workspace', () => {
    expect(chatRoute({ id: 'c1', title: 't', workspaceId: 'ws9' })).toBe('/workspace/ws9/chat/c1')
  })
})

describe('buildTrayMenuTemplate', () => {
  it('includes actions, recents, and quit', () => {
    const deps = makeDeps()
    const template = buildTrayMenuTemplate(deps, [
      { id: 'c1', title: 'Fix the sync', workspaceId: 'ws1' },
    ])
    const labels = template.map((item) => item.label ?? item.role ?? item.type)
    expect(labels).toEqual([
      'Open Sim',
      'New Chat',
      'Quick Ask',
      'separator',
      'Recent Chats',
      'Fix the sync',
      'separator',
      'Settings…',
      'Check for Updates…',
      'separator',
      'Quit Sim',
    ])

    const quickAsk = template.find((item) => item.label === 'Quick Ask')
    expect(quickAsk?.accelerator).toBe('Alt+Space')
    ;(quickAsk?.click as () => void)()
    expect(deps.toggleLauncher).toHaveBeenCalledTimes(1)

    const chat = template.find((item) => item.label === 'Fix the sync')
    ;(chat?.click as () => void)()
    expect(deps.openMainWindow).toHaveBeenCalledWith('/workspace/ws1/chat/c1')
  })

  it('omits the recents section when empty and the hint when disabled', () => {
    const template = buildTrayMenuTemplate(makeDeps({ launcherShortcut: () => 'disabled' }), [])
    expect(template.some((item) => item.label === 'Recent Chats')).toBe(false)
    expect(template.find((item) => item.label === 'Quick Ask')?.accelerator).toBeUndefined()
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
