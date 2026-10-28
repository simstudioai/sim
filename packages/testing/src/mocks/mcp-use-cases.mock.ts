import { vi } from 'vitest'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot'],
} as const

const DISCOVERY_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const

/**
 * The `mcpServerOperations` entries the use cases carry, copied from
 * `@/lib/mcp/application/operations` (real ids, roles, capabilities and principal policies).
 */
const MCP_OPERATIONS = {
  list: {
    id: 'mcp_servers.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  },
  discoverTools: {
    id: 'mcp_servers.tools.discover',
    oauthScope: 'api:write',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'mcp_tools.use',
    ...DISCOVERY_PRINCIPAL_POLICY,
  },
  read: {
    id: 'mcp_servers.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  },
  create: {
    id: 'mcp_servers.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  },
  register: {
    id: 'mcp_servers.register',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  },
  update: {
    id: 'mcp_servers.update',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  },
  reconfigure: {
    id: 'mcp_servers.reconfigure',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  },
  delete: {
    id: 'mcp_servers.delete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'mcp_tools.use',
    ...ALL_PRINCIPAL_POLICY,
  },
} as const

/** Real `MCP_SERVER_DELEGATION_AUDIENCE`, which every MCP use case exposes as `delegationAudience`. */
const MCP_SERVER_DELEGATION_AUDIENCE = 'sim:mcp-servers'

/**
 * Controllable mock functions for `@/lib/mcp/application/use-cases`, two per use case:
 * `mock<UseCase>` is its `execute` and `mock<UseCase>Authorize` is its `authorize`.
 * Every fn is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
 *
 * mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase.mockResolvedValue({ tools: [] })
 * ```
 */
export const mcpUseCasesMockFns = {
  mockListMcpServersUseCase: vi.fn(),
  mockListMcpServersUseCaseAuthorize: vi.fn(),
  mockDiscoverMcpToolsUseCase: vi.fn(),
  mockDiscoverMcpToolsUseCaseAuthorize: vi.fn(),
  mockDiscoverMcpServerToolsUseCase: vi.fn(),
  mockDiscoverMcpServerToolsUseCaseAuthorize: vi.fn(),
  mockGetMcpServerUseCase: vi.fn(),
  mockGetMcpServerUseCaseAuthorize: vi.fn(),
  mockCreateMcpServerUseCase: vi.fn(),
  mockCreateMcpServerUseCaseAuthorize: vi.fn(),
  mockRegisterMcpServerUseCase: vi.fn(),
  mockRegisterMcpServerUseCaseAuthorize: vi.fn(),
  mockUpdateMcpServerUseCase: vi.fn(),
  mockUpdateMcpServerUseCaseAuthorize: vi.fn(),
  mockReconfigureMcpServerUseCase: vi.fn(),
  mockReconfigureMcpServerUseCaseAuthorize: vi.fn(),
  mockDeleteMcpServerUseCase: vi.fn(),
  mockDeleteMcpServerUseCaseAuthorize: vi.fn(),
}

/**
 * Static mock module for `@/lib/mcp/application/use-cases`. Each use case is
 * `{ operation, delegationAudience, authorize, execute }` with the real operation definition and
 * delegation audience, so route builders that read `useCase.operation` keep working.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)
 * ```
 */
export const mcpUseCasesMock = {
  listMcpServersUseCase: {
    operation: MCP_OPERATIONS.list,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockListMcpServersUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockListMcpServersUseCase,
  },
  discoverMcpToolsUseCase: {
    operation: MCP_OPERATIONS.discoverTools,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockDiscoverMcpToolsUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockDiscoverMcpToolsUseCase,
  },
  discoverMcpServerToolsUseCase: {
    operation: MCP_OPERATIONS.discoverTools,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase,
  },
  getMcpServerUseCase: {
    operation: MCP_OPERATIONS.read,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockGetMcpServerUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockGetMcpServerUseCase,
  },
  createMcpServerUseCase: {
    operation: MCP_OPERATIONS.create,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockCreateMcpServerUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockCreateMcpServerUseCase,
  },
  registerMcpServerUseCase: {
    operation: MCP_OPERATIONS.register,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockRegisterMcpServerUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockRegisterMcpServerUseCase,
  },
  updateMcpServerUseCase: {
    operation: MCP_OPERATIONS.update,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockUpdateMcpServerUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockUpdateMcpServerUseCase,
  },
  reconfigureMcpServerUseCase: {
    operation: MCP_OPERATIONS.reconfigure,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockReconfigureMcpServerUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockReconfigureMcpServerUseCase,
  },
  deleteMcpServerUseCase: {
    operation: MCP_OPERATIONS.delete,
    delegationAudience: MCP_SERVER_DELEGATION_AUDIENCE,
    authorize: mcpUseCasesMockFns.mockDeleteMcpServerUseCaseAuthorize,
    execute: mcpUseCasesMockFns.mockDeleteMcpServerUseCase,
  },
}
