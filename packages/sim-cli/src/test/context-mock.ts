import { vi } from 'vitest'
import type { OutputFormat, SettingSource } from '../config/index'

/**
 * Per-test knobs read on every `clientFrom` call, so a test changes them
 * between invocations. They persist across tests: reset the ones a file
 * changes in its `beforeEach` (e.g. `contextMockState.output = 'json'`).
 */
export const contextMockState: {
  output: OutputFormat
  workspaceId: string
  workspaceSource: SettingSource
} = {
  output: 'json',
  workspaceId: 'ws_local',
  workspaceSource: 'config',
}

/** The resolved profile `clientFrom` and `profileFrom` return, built from {@link contextMockState}. */
export function mockedProfile() {
  return {
    workspaceId: contextMockState.workspaceId,
    output: contextMockState.output,
    name: 'default',
    authProfile: 'default',
    apiKey: 'k',
    endpoint: 'https://sim.example',
    sources: { workspaceId: contextMockState.workspaceSource },
  }
}

/**
 * The `SimClient` methods protocol commands call, plus the context entry
 * points. Non-bare defaults: `mockRequireWorkspace` returns
 * the workspace it is given, else `contextMockState.workspaceId`; `mockClientFrom` returns
 * `{ client: { request, requestRaw, requireWorkspace }, profile }` with the
 * profile built from {@link contextMockState} (name `default`, api key `k`,
 * endpoint `https://sim.example`).
 */
export const contextMockFns = {
  mockRequest: vi.fn(),
  mockRequestRaw: vi.fn(),
  mockRequireWorkspace: vi.fn((explicit?: string) => explicit ?? contextMockState.workspaceId),
  mockGlobalsOf: vi.fn(),
  mockProfileFrom: vi.fn(mockedProfile),
  mockClientFrom: vi.fn(() => ({
    client: {
      request: contextMockFns.mockRequest,
      requestRaw: contextMockFns.mockRequestRaw,
      requireWorkspace: contextMockFns.mockRequireWorkspace,
    },
    profile: mockedProfile(),
  })),
}

/**
 * Module shape of `src/context.ts`. Load it lazily inside the factory: a test
 * whose other imports reach `context.ts` first would otherwise read the
 * static import before it initializes.
 *
 *   vi.mock('../../context', async () => (await import('../../test/context-mock')).contextMock)
 */
export const contextMock = {
  globalsOf: contextMockFns.mockGlobalsOf,
  profileFrom: contextMockFns.mockProfileFrom,
  clientFrom: contextMockFns.mockClientFrom,
}
