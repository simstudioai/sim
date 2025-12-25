/**
 * Global setup utilities that run once before all tests.
 *
 * Use this for expensive setup that should only happen once.
 */

import { vi } from 'vitest'

/**
 * Suppresses specific console warnings/errors during tests.
 */
export function suppressConsoleWarnings(patterns: RegExp[]): void {
  const originalWarn = console.warn
  const originalError = console.error

  console.warn = (...args: any[]) => {
    const message = args.join(' ')
    if (patterns.some((pattern) => pattern.test(message))) {
      return
    }
    originalWarn.apply(console, args)
  }

  console.error = (...args: any[]) => {
    const message = args.join(' ')
    if (patterns.some((pattern) => pattern.test(message))) {
      return
    }
    originalError.apply(console, args)
  }
}

/**
 * Common patterns to suppress in tests.
 */
export const COMMON_SUPPRESS_PATTERNS = [
  /Zustand.*persist middleware/i,
  /React does not recognize the.*prop/,
  /Warning: Invalid DOM property/,
  /act\(\) warning/,
]

/**
 * Sets up global mocks for Node.js environment.
 */
export function setupNodeEnvironment(): void {
  // Mock window if not present
  if (typeof window === 'undefined') {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:3000' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  }

  // Mock document if not present
  if (typeof document === 'undefined') {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        style: {},
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
      })),
      body: { appendChild: vi.fn() },
    })
  }
}

/**
 * Cleans up global mocks after tests.
 */
export function cleanupGlobalMocks(): void {
  vi.unstubAllGlobals()
}
