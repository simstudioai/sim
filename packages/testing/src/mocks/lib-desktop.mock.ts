import { vi } from 'vitest'

interface MockDesktopBridge {
  version?: string
  updates?: unknown
}

const mockGetDesktopBridge = vi.fn((): unknown => undefined)

function isDesktop(): boolean {
  return mockGetDesktopBridge() != null
}

/**
 * Controllable mock functions for `@/lib/desktop`.
 *
 * `mockGetDesktopBridge` returns `undefined` (a plain browser). Every other accessor is a faithful
 * port that reads the bridge through `mockGetDesktopBridge`, so a test sets the bridge once:
 * - `isDesktopApp`/`hasLocalFilesystem`/`hasBrowserAgent`/`hasTerminal`/`hasDesktopSettings`/
 *   `prefersInPlaceNavigation`/`isBrowserAgentEnabled`/`isTerminalEnabled` are
 *   `getDesktopBridge() != null` (device switches read as enabled, the real unread default). The
 *   real check is `!== undefined`; `null` is also treated as "no bridge" because several local
 *   stubs returned `null` for the browser case.
 * - `getDesktopShellVersion` returns `bridge?.version`, `getDesktopUpdates` returns `bridge?.updates`.
 * - `mockSubscribeDesktopPreferences` returns a no-op unsubscribe; `mockSetDesktopPreferencesSnapshot`
 *   is a no-op; `mockGetDesktopChatCapabilities` resolves `{}` (the web result).
 *
 * @example
 * ```ts
 * import { libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
 *
 * libDesktopMockFns.mockGetDesktopBridge.mockReturnValue({ openExternal: vi.fn() })
 * ```
 */
export const libDesktopMockFns = {
  mockGetDesktopBridge,
  mockIsDesktopApp: vi.fn(isDesktop),
  mockHasLocalFilesystem: vi.fn(isDesktop),
  mockHasBrowserAgent: vi.fn(isDesktop),
  mockHasTerminal: vi.fn(isDesktop),
  mockHasDesktopSettings: vi.fn(isDesktop),
  mockPrefersInPlaceNavigation: vi.fn(isDesktop),
  mockSubscribeDesktopPreferences: vi.fn((_listener: () => void) => () => {}),
  mockSetDesktopPreferencesSnapshot: vi.fn((_preferences: unknown): void => {}),
  mockIsBrowserAgentEnabled: vi.fn(isDesktop),
  mockIsTerminalEnabled: vi.fn(isDesktop),
  mockGetDesktopShellVersion: vi.fn(
    (): string | undefined => (mockGetDesktopBridge() as MockDesktopBridge | undefined)?.version
  ),
  mockGetDesktopUpdates: vi.fn(
    (): unknown => (mockGetDesktopBridge() as MockDesktopBridge | undefined)?.updates
  ),
  mockGetDesktopChatCapabilities: vi.fn(async (_scopeId: string): Promise<unknown> => ({})),
}

/**
 * Static mock module for `@/lib/desktop`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/desktop', () => libDesktopMock)
 * ```
 */
export const libDesktopMock = {
  getDesktopBridge: libDesktopMockFns.mockGetDesktopBridge,
  isDesktopApp: libDesktopMockFns.mockIsDesktopApp,
  hasLocalFilesystem: libDesktopMockFns.mockHasLocalFilesystem,
  hasBrowserAgent: libDesktopMockFns.mockHasBrowserAgent,
  hasTerminal: libDesktopMockFns.mockHasTerminal,
  hasDesktopSettings: libDesktopMockFns.mockHasDesktopSettings,
  prefersInPlaceNavigation: libDesktopMockFns.mockPrefersInPlaceNavigation,
  subscribeDesktopPreferences: libDesktopMockFns.mockSubscribeDesktopPreferences,
  setDesktopPreferencesSnapshot: libDesktopMockFns.mockSetDesktopPreferencesSnapshot,
  isBrowserAgentEnabled: libDesktopMockFns.mockIsBrowserAgentEnabled,
  isTerminalEnabled: libDesktopMockFns.mockIsTerminalEnabled,
  getDesktopShellVersion: libDesktopMockFns.mockGetDesktopShellVersion,
  getDesktopUpdates: libDesktopMockFns.mockGetDesktopUpdates,
  getDesktopChatCapabilities: libDesktopMockFns.mockGetDesktopChatCapabilities,
}
