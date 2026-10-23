import { vi } from 'vitest'
import type { OutputFormat } from '../config/index'

/**
 * Per-test knobs read on every `clientFrom` call, so a test changes them
 * between invocations. They persist across tests: reset the ones a file
 * changes in its `beforeEach` (e.g. `contextMockState.output = 'json'`).
 */
export const contextMockState: { output: OutputFormat; workspaceId: string } = {
  output: 'json',
  workspaceId: 'ws_local',
}

/**
 * The `SimClient` methods protocol commands call, plus the context entry
 * points. Non-bare defaults: `mockRequireWorkspace` returns
 * `contextMockState.workspaceId`; `mockClientFrom` returns
 * `{ client: { request, requestRaw, requireWorkspace }, profile }` with the
 * profile built from {@link contextMockState} (name `default`, api key `k`,
 * endpoint `https://sim.example`).
 */
export const contextMockFns = {
  mockRequest: vi.fn(),
  mockRequestRaw: vi.fn(),
  mockRequireWorkspace: vi.fn(() => contextMockState.workspaceId),
  mockGlobalsOf: vi.fn(),
  mockProfileFrom: vi.fn(),
  mockClientFrom: vi.fn(() => ({
    client: {
      request: contextMockFns.mockRequest,
      requestRaw: contextMockFns.mockRequestRaw,
      requireWorkspace: contextMockFns.mockRequireWorkspace,
    },
    profile: {
      workspaceId: contextMockState.workspaceId,
      output: contextMockState.output,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
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
