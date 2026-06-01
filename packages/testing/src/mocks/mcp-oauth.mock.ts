import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mcp/oauth`.
 *
 * @example
 * ```ts
 * import { mcpOauthMockFns } from '@sim/testing'
 *
 * mcpOauthMockFns.mockGetOrCreateOauthRow.mockResolvedValue({ id: 'oauth-row-1', ... })
 * ```
 */
export const mcpOauthMockFns = {
  mockAssertSafeOauthServerUrl: vi.fn(),
  mockGetOrCreateOauthRow: vi.fn(),
  mockLoadOauthRow: vi.fn(),
  mockLoadOauthRowByState: vi.fn(),
  mockLoadPreregisteredClient: vi.fn(),
  mockSetOauthRowUser: vi.fn(),
  mockSaveClientInformation: vi.fn(),
  mockSaveTokens: vi.fn(),
  mockSaveCodeVerifier: vi.fn(),
  mockSaveState: vi.fn(),
  mockClearTokens: vi.fn(),
  mockClearClient: vi.fn(),
  mockClearVerifier: vi.fn(),
  mockClearState: vi.fn(),
  mockRevokeMcpOauthTokens: vi.fn(),
  mockWithMcpOauthRefreshLock: vi.fn(async (_rowId: string, fn: () => Promise<unknown>) => fn()),
}

export class McpOauthRedirectRequiredMock extends Error {
  constructor(public readonly authorizationUrl: string) {
    super('MCP OAuth redirect required')
    this.name = 'McpOauthRedirectRequiredMock'
  }
}

export class McpOauthInsecureUrlErrorMock extends Error {
  constructor(public readonly url: string) {
    super(`Insecure MCP OAuth server URL: ${url}`)
    this.name = 'McpOauthInsecureUrlErrorMock'
  }
}

/**
 * Returns the provider config back as the constructed instance, matching the
 * original identity passthrough. Declared as a named function (not an arrow) so
 * it stays constructable under vitest 4's `Reflect.construct` path while
 * remaining assignable to `mockImplementation`.
 */
function buildSimMcpOauthProvider(value: object) {
  return value
}

/**
 * Static mock module for `@/lib/mcp/oauth`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mcp/oauth', () => mcpOauthMock)
 * ```
 */
export const mcpOauthMock = {
  assertSafeOauthServerUrl: mcpOauthMockFns.mockAssertSafeOauthServerUrl,
  getOrCreateOauthRow: mcpOauthMockFns.mockGetOrCreateOauthRow,
  loadOauthRow: mcpOauthMockFns.mockLoadOauthRow,
  loadOauthRowByState: mcpOauthMockFns.mockLoadOauthRowByState,
  loadPreregisteredClient: mcpOauthMockFns.mockLoadPreregisteredClient,
  setOauthRowUser: mcpOauthMockFns.mockSetOauthRowUser,
  saveClientInformation: mcpOauthMockFns.mockSaveClientInformation,
  saveTokens: mcpOauthMockFns.mockSaveTokens,
  saveCodeVerifier: mcpOauthMockFns.mockSaveCodeVerifier,
  saveState: mcpOauthMockFns.mockSaveState,
  clearTokens: mcpOauthMockFns.mockClearTokens,
  clearClient: mcpOauthMockFns.mockClearClient,
  clearVerifier: mcpOauthMockFns.mockClearVerifier,
  clearState: mcpOauthMockFns.mockClearState,
  revokeMcpOauthTokens: mcpOauthMockFns.mockRevokeMcpOauthTokens,
  withMcpOauthRefreshLock: mcpOauthMockFns.mockWithMcpOauthRefreshLock,
  McpOauthRedirectRequired: McpOauthRedirectRequiredMock,
  McpOauthInsecureUrlError: McpOauthInsecureUrlErrorMock,
  SimMcpOauthProvider: vi.fn().mockImplementation(buildSimMcpOauthProvider),
}
