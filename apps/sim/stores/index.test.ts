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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the broad store graph only when cleanup runs and preserves allowed preferences', async () => {
    expect(mockModuleLoaded).not.toHaveBeenCalled()

    localStorage.setItem('next-favicon', 'favicon')
    localStorage.setItem('theme', 'dark')
    localStorage.setItem(RECENT_IMPERSONATIONS_STORAGE_KEY, '["user-a"]')
    localStorage.setItem('private-cache', 'remove-me')

    await clearUserData()

    expect(mockModuleLoaded).toHaveBeenCalledOnce()
    expect(mockResetAllStores).toHaveBeenCalledOnce()
    expect(localStorage.getItem('next-favicon')).toBe('favicon')
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(localStorage.getItem(RECENT_IMPERSONATIONS_STORAGE_KEY)).toBe('["user-a"]')
    expect(localStorage.getItem('private-cache')).toBeNull()
  })

  it('clears persisted user data even when the lazy store reset fails', async () => {
    localStorage.setItem('private-cache', 'remove-me')
    mockResetAllStores.mockImplementationOnce(() => {
      throw new Error('Chunk unavailable')
    })

    await clearUserData()

    expect(mockResetAllStores).toHaveBeenCalledOnce()
    expect(localStorage.getItem('private-cache')).toBeNull()
  })
})
