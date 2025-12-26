import { vi } from 'vitest'

/**
 * Creates a mock storage implementation (localStorage/sessionStorage).
 *
 * @example
 * ```ts
 * const storage = createMockStorage()
 * storage.setItem('key', 'value')
 * expect(storage.getItem('key')).toBe('value')
 * ```
 */
export function createMockStorage(): Storage {
  const store: Record<string, string> = {}

  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key])
    }),
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    get length() {
      return Object.keys(store).length
    },
  }
}

/**
 * Sets up global localStorage and sessionStorage mocks.
 *
 * @example
 * ```ts
 * // In vitest.setup.ts
 * setupGlobalStorageMocks()
 * ```
 */
export function setupGlobalStorageMocks() {
  const localStorageMock = createMockStorage()
  const sessionStorageMock = createMockStorage()

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
  })

  Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorageMock,
    writable: true,
  })

  return { localStorage: localStorageMock, sessionStorage: sessionStorageMock }
}

/**
 * Clears all storage mock data and calls.
 */
export function clearStorageMocks() {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
    vi.mocked(localStorage.getItem).mockClear()
    vi.mocked(localStorage.setItem).mockClear()
    vi.mocked(localStorage.removeItem).mockClear()
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear()
    vi.mocked(sessionStorage.getItem).mockClear()
    vi.mocked(sessionStorage.setItem).mockClear()
    vi.mocked(sessionStorage.removeItem).mockClear()
  }
}
