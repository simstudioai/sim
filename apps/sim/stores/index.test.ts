/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockModuleLoaded, mockResetAllStores } = vi.hoisted(() => ({
  mockModuleLoaded: vi.fn(),
  mockResetAllStores: vi.fn(),
}))

vi.mock('@/stores/reset-all-stores', () => {
  mockModuleLoaded()
  return { resetAllStores: mockResetAllStores }
})

import { clearUserData, RECENT_IMPERSONATIONS_STORAGE_KEY } from '@/stores'

expect(mockModuleLoaded).not.toHaveBeenCalled()

class EnumerableStorage implements Storage {
  get length(): number {
    return Object.keys(this).length
  }

  clear(): void {
    Object.keys(this).forEach((key) => Reflect.deleteProperty(this, key))
  }

  getItem(key: string): string | null {
    const value = Reflect.get(this, key)
    return typeof value === 'string' ? value : null
  }

  key(index: number): string | null {
    return Object.keys(this)[index] ?? null
  }

  removeItem(key: string): void {
    Reflect.deleteProperty(this, key)
  }

  setItem(key: string, value: string): void {
    Object.defineProperty(this, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  }
}

describe('clearUserData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', new EnumerableStorage())
    vi.stubGlobal('sessionStorage', new EnumerableStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears identity data while preserving device preferences', async () => {
    localStorage.setItem('next-favicon', 'favicon')
    localStorage.setItem('sim-theme', 'dark')
    localStorage.setItem('sim-landing-theme', 'dark')
    localStorage.setItem(RECENT_IMPERSONATIONS_STORAGE_KEY, '["user-a"]')
    localStorage.setItem('private-cache', 'remove-me')
    sessionStorage.setItem('mothership-queue', 'private-queued-message')

    const inMemoryResetSucceeded = await clearUserData()

    expect(mockResetAllStores).toHaveBeenCalledOnce()
    expect(inMemoryResetSucceeded).toBe(true)
    expect(localStorage.getItem('next-favicon')).toBe('favicon')
    expect(localStorage.getItem('sim-theme')).toBe('dark')
    expect(localStorage.getItem('sim-landing-theme')).toBe('dark')
    expect(localStorage.getItem(RECENT_IMPERSONATIONS_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('private-cache')).toBeNull()
    expect(sessionStorage.getItem('mothership-queue')).toBeNull()
  })

  it('preserves recent impersonations only across an explicit impersonation transition', async () => {
    localStorage.setItem(RECENT_IMPERSONATIONS_STORAGE_KEY, '["user-a"]')

    await clearUserData({ preserveRecentImpersonations: true })

    expect(localStorage.getItem(RECENT_IMPERSONATIONS_STORAGE_KEY)).toBe('["user-a"]')
  })

  it('clears persisted user data even when the lazy store reset fails', async () => {
    localStorage.setItem('private-cache', 'remove-me')
    mockResetAllStores.mockImplementationOnce(() => {
      throw new Error('Chunk unavailable')
    })

    const inMemoryResetSucceeded = await clearUserData()

    expect(mockResetAllStores).toHaveBeenCalledOnce()
    expect(inMemoryResetSucceeded).toBe(false)
    expect(localStorage.getItem('private-cache')).toBeNull()
  })
})
