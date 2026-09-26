import { vi } from 'vitest'

/**
 * Controllable mock functions for the `mcpService` singleton of `@/lib/mcp/service`.
 *
 * Discovery and execution methods are bare `vi.fn()`s. Defaults: `mockClearCache` and
 * `mockEvictServerConnections` resolve `undefined` (their real `Promise<void>`), and
 * `mockDispose` is a no-op.
 *
 * @example
 * ```ts
 * import { mcpServiceMockFns } from '@sim/testing/mocks/mcp-service.mock'
 *
 * mcpServiceMockFns.mockDiscoverServerTools.mockResolvedValue([{ name: 'search' }])
 * ```
 */
export const mcpServiceMockFns = {
  mockDispose: vi.fn((): void => {}),
  mockDiscoverManagedMcpTools: vi.fn(),
  mockExecuteManagedMcpTool: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockDiscoverTools: vi.fn(),
  mockDiscoverServerTools: vi.fn(),
  mockGetServerSummaries: vi.fn(),
  mockClearCache: vi.fn(async (_workspaceId?: string): Promise<void> => {}),
  mockEvictServerConnections: vi.fn(
    async (_serverId: string, _reason: string): Promise<void> => {}
  ),
}

/**
 * Static mock module for `@/lib/mcp/service`. `mcpService` exposes every public method of the
 * real `McpService` instance.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mcp/service', () => mcpServiceMock)
 * ```
 */
export const mcpServiceMock = {
  mcpService: {
    dispose: mcpServiceMockFns.mockDispose,
    discoverManagedMcpTools: mcpServiceMockFns.mockDiscoverManagedMcpTools,
    executeManagedMcpTool: mcpServiceMockFns.mockExecuteManagedMcpTool,
    executeTool: mcpServiceMockFns.mockExecuteTool,
    discoverTools: mcpServiceMockFns.mockDiscoverTools,
    discoverServerTools: mcpServiceMockFns.mockDiscoverServerTools,
    getServerSummaries: mcpServiceMockFns.mockGetServerSummaries,
    clearCache: mcpServiceMockFns.mockClearCache,
    evictServerConnections: mcpServiceMockFns.mockEvictServerConnections,
  },
}
