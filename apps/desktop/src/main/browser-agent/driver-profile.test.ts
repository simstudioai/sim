import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

const mocks = vi.hoisted(() => ({
  clearProfileStorage: vi.fn(async () => {}),
  clearCredentials: vi.fn(async () => {}),
}))

vi.mock('@/main/browser-agent/session', () => ({
  clearProfileStorage: mocks.clearProfileStorage,
  initSession: vi.fn(),
}))

vi.mock('@/main/browser-credentials', () => ({
  clearCredentials: mocks.clearCredentials,
  fillCoordinator: vi.fn(() => null),
  initFillCoordinator: vi.fn(),
}))

import { clearBrowserProfile, initDriver } from '@/main/browser-agent/driver'
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
})
