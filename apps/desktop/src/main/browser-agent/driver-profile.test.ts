import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

const mocks = vi.hoisted(() => ({
  clearProfileStorage: vi.fn(async () => {}),
  clearCredentials: vi.fn(async () => {}),
}))

vi.mock('@/main/browser-agent/session', () => ({
  clearProfileStorage: mocks.clearProfileStorage,
  initSession: vi.fn(),
  isBrowserScopeSuspended: vi.fn(() => false),
  resolveBrowserScopeId: vi.fn((scopeId: string) => scopeId),
}))

vi.mock('@/main/browser-credentials', () => ({
  clearCredentials: mocks.clearCredentials,
  fillCoordinator: vi.fn(() => null),
  initFillCoordinator: vi.fn(),
}))

import {
  captureBrowserToolQueueBoundary,
  clearBrowserProfile,
  executeTool,
  initDriver,
} from '@/main/browser-agent/driver'
import type { ConfigStore } from '@/main/config'

describe('clearBrowserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires settings erasure for sign-out but lets explicit server repair replace it', async () => {
    const config = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      flush: vi.fn(() => false),
    } as unknown as ConfigStore
    initDriver(
      {
        onPageState: vi.fn(),
        onTabsState: vi.fn(),
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => null,
      config
    )

    await expect(clearBrowserProfile()).rejects.toThrow('Browser profile teardown was incomplete')
    await expect(
      clearBrowserProfile({ settingsPersistence: 'server-repair' })
    ).resolves.toBeUndefined()

    expect(mocks.clearProfileStorage).toHaveBeenCalledTimes(2)
    expect(mocks.clearCredentials).toHaveBeenCalledTimes(2)
    expect(config.flush).toHaveBeenCalledTimes(2)
  })

  it('invalidates pre-wipe authorization and retires live work before profile teardown', async () => {
    initDriver(
      {
        onPageState: vi.fn(),
        onTabsState: vi.fn(),
        onSessionStatus: vi.fn(),
        onFillAvailability: vi.fn(),
      },
      () => null
    )
    const boundary = captureBrowserToolQueueBoundary('chat-before-wipe')
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('Expected browser tool authorization admission')

    await clearBrowserProfile()
    const staleExecution = await executeTool(
      'chat-before-wipe',
      'browser_list_sessions',
      {},
      'tool-authorized-before-wipe',
      boundary
    )

    expect(mocks.clearProfileStorage).toHaveBeenCalledOnce()
    expect(mocks.clearCredentials).toHaveBeenCalledOnce()
    expect(staleExecution).toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled before it started'),
    })
  })
})
