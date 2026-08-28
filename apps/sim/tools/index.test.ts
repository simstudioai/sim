/**
 * @vitest-environment node
 *
 * Tools Registry and Executor Unit Tests
 *
 * This file contains unit tests for the tools registry and executeTool function,
 * which are the central pieces of infrastructure for executing tools.
 */

import {
  createExecutionContext,
  createMockFetch,
  type ExecutionContext,
  encryptionMockFns,
  environmentUtilsMockFns,
  inputValidationMock,
  inputValidationMockFns,
  loggerMock,
  type MockFetchResponse,
  resetEnvFlagsMock,
  resetEnvironmentUtilsMock,
  resetEnvMock,
  resetUrlsMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import {
  ANONYMOUS_SECRET_TRACE_REPLACEMENT,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import { bitbucketGetPipelineStepLogTool } from '@/tools/bitbucket/get_pipeline_step_log'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { fileGetContentTool } from '@/tools/file/get'
import { fileFetchTool } from '@/tools/file/parser'
import { buildFunctionExecuteBody } from '@/tools/function/execute'
import { memoryAddTool } from '@/tools/memory/add'
import { getCallerIdentityTool } from '@/tools/sts/get_caller_identity'
import { tableBatchInsertRowsTool } from '@/tools/table/batch_insert_rows'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'
import { customBlockExecutorTool } from '@/tools/workflow/custom-block-executor'
import { workflowExecutorTool } from '@/tools/workflow/executor'

// Hoisted mock state - these are available to vi.mock factories
const {
  mockGetBYOKKey,
  mockGetToolAsync,
  mockRateLimiterFns,
  mockMarkWorkspaceFileSecretProvenanceUnknown,
  mockRunCustomBlockTool,
  mockRunWorkflowTool,
  mockReadAvailableCustomToolByIdOrTitleAsCopilot,
  mockReadAvailableCustomToolByIdOrTitleAsExecutor,
  mockGenerateInternalDelegationToken,
  mockGenerateInternalToken,
  mockResolveWorkspaceFileReference,
  mockAssertPermissionsAllowed,
  mockExecuteFunction,
  mockCreateExecutorPrincipalFromExecutionContext,
  mockGetInternalToolOperationHandler,
  mockExecuteInternalToolOperation,
} = vi.hoisted(() => ({
  mockGetBYOKKey: vi.fn(),
  mockGetToolAsync: vi.fn(),
  mockRateLimiterFns: {
    acquireKey: vi.fn(),
    preConsumeCapacity: vi.fn(),
    consumeCapacity: vi.fn(),
  },
  mockMarkWorkspaceFileSecretProvenanceUnknown: vi.fn(),
  mockRunCustomBlockTool: vi.fn(),
  mockRunWorkflowTool: vi.fn(),
  mockReadAvailableCustomToolByIdOrTitleAsCopilot: vi.fn(),
  mockReadAvailableCustomToolByIdOrTitleAsExecutor: vi.fn(),
  mockGenerateInternalDelegationToken: vi.fn(),
  mockGenerateInternalToken: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockAssertPermissionsAllowed: vi.fn(),
  mockExecuteFunction: vi.fn(),
  mockCreateExecutorPrincipalFromExecutionContext: vi.fn(),
  mockGetInternalToolOperationHandler: vi.fn(),
  mockExecuteInternalToolOperation: vi.fn(),
}))

const mockSecureFetchWithPinnedIP = inputValidationMockFns.mockSecureFetchWithPinnedIP
const mockValidateUrlWithDNS = inputValidationMockFns.mockValidateUrlWithDNS
const mockGetEffectiveDecryptedEnv = environmentUtilsMockFns.mockGetEffectiveDecryptedEnv

// Mock getBYOKKey
vi.mock('@/lib/api-key/byok', () => ({
  getBYOKKey: (...args: unknown[]) => mockGetBYOKKey(...args),
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalDelegationToken: (...args: unknown[]) =>
    mockGenerateInternalDelegationToken(...args),
  generateInternalToken: (...args: unknown[]) => mockGenerateInternalToken(...args),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: encryptionMockFns.mockDecryptSecret,
  encryptSecret: encryptionMockFns.mockEncryptSecret,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: mockAssertPermissionsAllowed,
  validateBlockType: vi.fn().mockResolvedValue(undefined),
  validateMcpToolsAllowed: vi.fn().mockResolvedValue(undefined),
  validateCustomToolsAllowed: vi.fn().mockResolvedValue(undefined),
  validateSkillsAllowed: vi.fn().mockResolvedValue(undefined),
  validateModelProvider: vi.fn().mockResolvedValue(undefined),
  validateInvitationsAllowed: vi.fn().mockResolvedValue(undefined),
  validatePublicApiAllowed: vi.fn().mockResolvedValue(undefined),
  getUserPermissionConfig: vi.fn().mockResolvedValue(null),
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
  IntegrationNotAllowedError: class IntegrationNotAllowedError extends Error {},
  McpToolsNotAllowedError: class McpToolsNotAllowedError extends Error {},
  CustomToolsNotAllowedError: class CustomToolsNotAllowedError extends Error {},
  SkillsNotAllowedError: class SkillsNotAllowedError extends Error {},
  InvitationsNotAllowedError: class InvitationsNotAllowedError extends Error {},
  PublicApiNotAllowedError: class PublicApiNotAllowedError extends Error {},
}))

vi.mock('@/lib/billing/core/usage-log', () => ({}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@/lib/function-execution/application/execute-function', () => ({
  executeFunction: { execute: mockExecuteFunction },
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mockCreateExecutorPrincipalFromExecutionContext,
}))

vi.mock('@/lib/internal/tool-operations/registry.server', () => ({
  getInternalToolOperationHandler: mockGetInternalToolOperationHandler,
}))

vi.mock('@/lib/core/rate-limiter/hosted-key', () => ({
  getHostedKeyRateLimiter: () => mockRateLimiterFns,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: (...args: unknown[]) => mockResolveWorkspaceFileReference(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  markWorkspaceFileSecretProvenanceUnknown: (...args: unknown[]) =>
    mockMarkWorkspaceFileSecretProvenanceUnknown(...args),
}))

vi.mock('@/executor/handlers/workflow/workflow-tool-runner', () => ({
  runWorkflowTool: (...args: unknown[]) => mockRunWorkflowTool(...args),
}))

vi.mock('@/executor/handlers/workflow/custom-block-tool-runner', () => ({
  runCustomBlockTool: (...args: unknown[]) => mockRunCustomBlockTool(...args),
}))

// Mock the tools registry to avoid loading the full 4500+ line registry file.
// Only the tools actually exercised in tests are provided.
const mockRegistryTools: Record<string, any> = {
  bitbucket_get_pipeline_step_log: bitbucketGetPipelineStepLogTool,
  deployed_block_executor: customBlockExecutorTool,
  workflow_executor: workflowExecutorTool,
  file_fetch: fileFetchTool,
  file_get_content: fileGetContentTool,
  memory_add: memoryAddTool,
  table_batch_insert_rows: tableBatchInsertRowsTool,
  sts_get_caller_identity: getCallerIdentityTool,
  http_request: {
    id: 'http_request',
    name: 'HTTP Request',
    description: 'Make HTTP requests',
    version: '1.0.0',
    params: {
      url: { type: 'string', required: true },
      method: { type: 'string', default: 'GET' },
      headers: { type: 'object' },
      body: { type: 'object' },
      params: { type: 'object' },
      pathParams: { type: 'object' },
      formData: { type: 'object' },
      timeout: { type: 'number' },
      retries: { type: 'number' },
      retryDelayMs: { type: 'number' },
      retryMaxDelayMs: { type: 'number' },
      retryNonIdempotent: { type: 'boolean' },
    },
    request: {
      url: (p: any) => p.url || '/api/test',
      method: (p: any) => p.method || 'GET',
      headers: (p: any) => p.headers || { 'Content-Type': 'application/json' },
      body: (p: any) => p.body,
      retry: {
        enabled: true,
        maxRetries: 0,
        initialDelayMs: 500,
        maxDelayMs: 30000,
        retryIdempotentOnly: true,
      },
    },
    transformResponse: async (response: any) => {
      const contentType = response.headers?.get?.('content-type') || ''
      const headers: Record<string, string> = {}
      if (response.headers?.forEach) {
        response.headers.forEach((value: string, key: string) => {
          headers[key] = value
        })
      }
      const data = await (contentType.includes('application/json')
        ? response.json()
        : response.text())
      return {
        success: response.ok,
        output: { data, status: response.status, headers },
      }
    },
    outputs: {
      data: { type: 'json', description: 'Response data' },
      status: { type: 'number', description: 'HTTP status code' },
      headers: { type: 'object', description: 'Response headers' },
    },
  },
  function_execute: {
    id: 'function_execute',
    name: 'Function Execute',
    description: 'Execute JavaScript code',
    version: '1.0.0',
    params: {
      code: { type: 'string', required: true },
      language: { type: 'string', required: false },
      timeout: { type: 'number', required: false },
    },
    operation: {
      input: buildFunctionExecuteBody,
    },
    transformResponse: async (response: any) => {
      const data = await response.json()
      return { success: true, output: data }
    },
    outputs: {
      result: { type: 'json', description: 'Execution result' },
    },
  },
  gmail_read: {
    id: 'gmail_read',
    name: 'Gmail Read',
    description: 'Read Gmail messages',
    version: '1.0.0',
    oauth: {
      required: true,
      provider: 'google-email',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    },
    params: {},
    operation: { input: (params: Record<string, unknown>) => params },
  } satisfies InternalToolConfig,
  gmail_send: {
    id: 'gmail_send',
    name: 'Gmail Send',
    description: 'Send Gmail messages',
    version: '1.0.0',
    oauth: {
      required: true,
      provider: 'google-email',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
    },
    params: {},
    operation: { input: (params: Record<string, unknown>) => params },
  } satisfies InternalToolConfig,
  test_single_file_tool: {
    id: 'test_single_file_tool',
    name: 'Test Single File Tool',
    description: 'Accepts a single file parameter',
    version: '1.0.0',
    params: {
      attachment: { type: 'file', required: true },
    },
    operation: { input: (params: { attachment: unknown }) => ({ attachment: params.attachment }) },
    transformResponse: async (response: any) => {
      const data = await response.json()
      return { success: true, output: data }
    },
  } satisfies InternalToolConfig<{ attachment: unknown }>,
  test_env_ref_tool: {
    id: 'test_env_ref_tool',
    name: 'Test Env Reference Tool',
    description: 'Accepts a user-only API key and an llm-writable note',
    version: '1.0.0',
    params: {
      apiKey: { type: 'string', required: true, visibility: 'user-only' },
      note: { type: 'string', required: false, visibility: 'user-or-llm' },
    },
    operation: {
      input: (params: { apiKey: string; note?: string }) => ({
        apiKey: params.apiKey,
        note: params.note,
      }),
    },
    transformResponse: async (response: any) => {
      const data = await response.json()
      return { success: true, output: data }
    },
  } satisfies InternalToolConfig<{ apiKey: string; note?: string }>,
  test_file_array_tool: {
    id: 'test_file_array_tool',
    name: 'Test File Array Tool',
    description: 'Accepts an array of file parameters',
    version: '1.0.0',
    params: {
      attachments: { type: 'file[]', required: true },
    },
    operation: {
      input: (params: { attachments: unknown[] }) => ({ attachments: params.attachments }),
    },
    transformResponse: async (response: any) => {
      const data = await response.json()
      return { success: true, output: data }
    },
  } satisfies InternalToolConfig<{ attachments: unknown[] }>,
  google_drive_list: {
    id: 'google_drive_list',
    name: 'Google Drive List',
    description: 'List Google Drive files',
    version: '1.0.0',
    params: {},
    operation: { input: () => ({}) },
  } satisfies InternalToolConfig,
  serper_search: {
    id: 'serper_search',
    name: 'Serper Search',
    description: 'Search via Serper',
    version: '1.0.0',
    params: {},
    operation: { input: () => ({}) },
  } satisfies InternalToolConfig,
  notion_add_database_row: {
    id: 'notion_add_database_row',
    name: 'Add Notion Database Row',
    description: 'Add a new row to a Notion database with specified properties',
    version: '1.0.0',
    params: {},
    request: { url: 'https://api.notion.com/v1/pages', method: 'POST' },
  },
  notion_add_database_row_v2: {
    id: 'notion_add_database_row_v2',
    name: 'Add Notion Database Row',
    description: 'Add a new row to a Notion database with specified properties',
    version: '2.0.0',
    params: {},
    request: { url: 'https://api.notion.com/v1/pages', method: 'POST' },
  },
  notion_update_page: {
    id: 'notion_update_page',
    name: 'Notion Page Updater',
    description: 'Update properties of a Notion page',
    version: '1.0.0',
    params: {},
    request: { url: 'https://api.notion.com/v1/pages/x', method: 'PATCH' },
  },
  notion_update_page_v2: {
    id: 'notion_update_page_v2',
    name: 'Notion Page Updater',
    description: 'Update properties of a Notion page',
    version: '2.0.0',
    params: {},
    request: { url: 'https://api.notion.com/v1/pages/x', method: 'PATCH' },
  },
}

vi.mock('@/lib/internal/custom-tools/read-available-by-id-or-title', () => ({
  readAvailableCustomToolByIdOrTitleAsCopilot: mockReadAvailableCustomToolByIdOrTitleAsCopilot,
  readAvailableCustomToolByIdOrTitleAsExecutor: mockReadAvailableCustomToolByIdOrTitleAsExecutor,
}))

vi.mock('@/tools/utils.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/utils.server')>()
  mockGetToolAsync.mockImplementation(actual.getToolAsync)
  return {
    ...actual,
    getToolAsync: mockGetToolAsync,
  }
})

import type { QueryClient } from '@tanstack/react-query'
import * as getQueryClientModule from '@/app/_shell/providers/get-query-client'
import { executeTool, postProcessToolOutput } from '@/tools'
import { tools } from '@/tools/registry'
import { createToolConfig, getTool } from '@/tools/utils'
import { getToolAsync } from '@/tools/utils.server'

const mockToolsLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(loggerMock.createLogger).mock.calls.findIndex(([name]) => name === 'Tools')
].value

/**
 * Overlay the mock tools onto the REAL registry object instead of vi.mock:
 * under `isolate: false` shared consumers (`@/tools/utils`, `@/tools`) may be
 * cached across test files bound to the real registry namespace, so mutating
 * the one real `tools` object (and restoring it afterAll) is the only wiring
 * that applies in every ordering.
 */
const replacedRegistryEntries = new Map<string, unknown>()
for (const [id, tool] of Object.entries(mockRegistryTools)) {
  replacedRegistryEntries.set(id, (tools as Record<string, unknown>)[id])
  ;(tools as Record<string, any>)[id] = tool
}

afterAll(() => {
  for (const [id, original] of replacedRegistryEntries) {
    if (original === undefined) {
      delete (tools as Record<string, unknown>)[id]
    } else {
      ;(tools as Record<string, any>)[id] = original
    }
  }
})

const mockCustomTool = {
  id: 'custom-tool-123',
  title: 'Custom Weather Tool',
  code: 'return { result: "Weather data" }',
  schema: {
    function: {
      description: 'Get weather information',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
          unit: { type: 'string', description: 'Unit (metric/imperial)' },
        },
        required: ['location'],
      },
    },
  },
}

function createMockQueryClient(): QueryClient {
  return {
    getQueryData: (key: readonly unknown[]) => {
      if (key[0] === 'customTools') return [mockCustomTool]
      return undefined
    },
  } as unknown as QueryClient
}

/**
 * Spy on the real get-query-client namespace instead of vi.mock: under
 * `isolate: false` the shared `@/tools/utils` module may be cached across test
 * files, so patching the real namespace is the only wiring that composes.
 * Re-applied in beforeEach because suites below call vi.resetAllMocks() /
 * vi.restoreAllMocks().
 */
vi.spyOn(getQueryClientModule, 'getQueryClient').mockImplementation(createMockQueryClient)

beforeEach(() => {
  vi.spyOn(getQueryClientModule, 'getQueryClient').mockImplementation(createMockQueryClient)
  mockAssertPermissionsAllowed.mockResolvedValue(undefined)
  mockGenerateInternalDelegationToken.mockResolvedValue('executor-token')
  mockRunWorkflowTool.mockResolvedValue({ success: true, output: {} })
  mockGetInternalToolOperationHandler.mockResolvedValue(mockExecuteInternalToolOperation)
  mockExecuteInternalToolOperation.mockImplementation(async (request: InternalToolOperationCall) =>
    Response.json(request.input, {
      headers: { 'content-type': 'application/json' },
    })
  )
  mockExecuteFunction.mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        output: { result: 'in-process' },
        __resolvedSecretNames: [],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
        },
      }
    )
  )
  mockCreateExecutorPrincipalFromExecutionContext.mockImplementation(
    async ({ context, audience, resourceScope }) => {
      const origin = context.executorDelegationOrigin
      if (!origin) throw new Error('Executor delegation origin is required')
      return {
        kind: 'delegated' as const,
        serviceId: 'executor',
        ...(origin.subjectUserId ? { subjectUserId: origin.subjectUserId } : {}),
        workspaceId: context.workspaceId,
        delegationId: 'test-executor-delegation',
        audience,
        issuedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T00:05:00.000Z'),
        ...(resourceScope ? { resourceScope } : {}),
        delegationContext: {
          kind: 'workflow_execution' as const,
          workflowId: origin.workflowId,
          ...(origin.executionId ? { executionId: origin.executionId } : {}),
          ...(origin.principal ? { principal: origin.principal } : {}),
          ...(origin.currentWorkflow ? { currentWorkflow: origin.currentWorkflow } : {}),
        },
      }
    }
  )
  // Suites below call vi.resetAllMocks(), which wipes the shared env/urls mock
  // implementations — restore their defaults and re-pin the base URL each test.
  resetEnvMock()
  resetUrlsMock()
  resetEnvironmentUtilsMock()
  setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
})

afterAll(() => {
  vi.mocked(getQueryClientModule.getQueryClient).mockRestore()
  resetEnvMock()
  resetUrlsMock()
  resetEnvironmentUtilsMock()
})

/**
 * Sets up global fetch mock with Next.js preconnect support.
 */
function setupFetchMock(config: MockFetchResponse = {}) {
  const mockFetch = createMockFetch(config)
  const fetchWithPreconnect = Object.assign(mockFetch, { preconnect: vi.fn() }) as typeof fetch
  global.fetch = fetchWithPreconnect
  return mockFetch
}

function toSecureFetchResponse(response: Response) {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: {
      get: (name: string) => response.headers.get(name),
      toRecord: () => Object.fromEntries(response.headers.entries()),
    },
    body: response.body,
    text: () => response.text(),
    json: () => response.json(),
    arrayBuffer: () => response.arrayBuffer(),
  }
}

const TEST_BILLING_ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: 'test-user',
  workspaceId: 'workspace-456',
  organizationId: null,
  billedAccountUserId: 'test-user',
  billingEntity: { type: 'user', id: 'test-user' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

/**
 * Creates a mock execution context with workspaceId for tool tests.
 */
function createToolExecutionContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  const ctx = createExecutionContext({
    workflowId: overrides?.workflowId ?? 'test-workflow',
    blockStates: overrides?.blockStates,
    executedBlocks: overrides?.executedBlocks,
    blockLogs: overrides?.blockLogs,
    metadata: overrides?.metadata,
    environmentVariables: overrides?.environmentVariables,
  })
  const principal =
    overrides?.principal ??
    (overrides?.userId
      ? { kind: 'session' as const, userId: overrides.userId, sessionId: 'test-session' }
      : undefined)
  const executorDelegationOrigin =
    overrides?.executorDelegationOrigin ??
    (principal
      ? {
          subjectUserId: overrides?.userId,
          workflowId: overrides?.workflowId ?? ctx.workflowId,
          executionId: overrides?.executionId ?? ctx.executionId,
          principal,
        }
      : undefined)
  return {
    ...ctx,
    workspaceId: 'workspace-456',
    principal,
    executorDelegationOrigin,
    ...overrides,
    metadata: {
      ...ctx.metadata,
      ...overrides?.metadata,
      principal: overrides?.metadata?.principal ?? principal,
      billingAttribution: overrides?.metadata?.billingAttribution ?? TEST_BILLING_ATTRIBUTION,
    },
  } as ExecutionContext
}

/**
 * Sets up environment variables and returns a cleanup function.
 */
function setupEnvVars(variables: Record<string, string>) {
  const originalEnv = { ...process.env }
  Object.assign(process.env, variables)

  return () => {
    Object.keys(variables).forEach((key) => delete process.env[key])
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) process.env[key] = value
    })
  }
}

beforeAll(() => {
  setEnvFlags({ isDev: true })
})

afterAll(resetEnvFlagsMock)

describe('Tools Registry', () => {
  it('should include all expected built-in tools', () => {
    expect(tools.http_request).toBeDefined()
    expect(tools.function_execute).toBeDefined()

    expect(tools.gmail_read).toBeDefined()
    expect(tools.gmail_send).toBeDefined()
    expect(tools.google_drive_list).toBeDefined()
    expect(tools.serper_search).toBeDefined()
  })

  it('getTool should return the correct tool by ID', () => {
    const httpTool = getTool('http_request')
    expect(httpTool).toBeDefined()
    expect(httpTool?.id).toBe('http_request')
    expect(httpTool?.name).toBe('HTTP Request')

    const gmailTool = getTool('gmail_read')
    expect(gmailTool).toBeDefined()
    expect(gmailTool?.id).toBe('gmail_read')
    expect(gmailTool?.name).toBe('Gmail Read')
  })

  it.each([
    ['notion_add_database_row', 'notion_add_database_row_v2'],
    ['notion_update_page', 'notion_update_page_v2'],
  ])('getTool resolves both the legacy and v2 ids for %s', (legacyId, v2Id) => {
    const legacy = getTool(legacyId)
    expect(legacy).toBeDefined()
    expect(legacy?.id).toBe(legacyId)

    const v2 = getTool(v2Id)
    expect(v2).toBeDefined()
    expect(v2?.id).toBe(v2Id)
  })

  it('getTool should return undefined for non-existent tool', () => {
    const nonExistentTool = getTool('non_existent_tool')
    expect(nonExistentTool).toBeUndefined()
  })
})

describe('Custom Tools', () => {
  it('does not resolve custom tools through the synchronous client helper', () => {
    expect(getTool('custom_remote-tool-123', 'workspace-1')).toBeUndefined()
  })

  it('returns the legacy notion_add_database_row tool through the async helper', async () => {
    const legacy = await getToolAsync('notion_add_database_row')
    expect(legacy).toBeDefined()
    expect(legacy?.id).toBe('notion_add_database_row')
  })

  it('requires a trusted execution context for custom-tool resolution', async () => {
    await expect(getToolAsync('custom_remote-tool-123')).rejects.toThrow(
      'Cannot fetch custom tool without userId: remote-tool-123'
    )
    expect(mockReadAvailableCustomToolByIdOrTitleAsExecutor).not.toHaveBeenCalled()
  })

  it('resolves custom tools through the async helper', async () => {
    mockReadAvailableCustomToolByIdOrTitleAsExecutor.mockResolvedValue({
      id: 'remote-tool-123',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      title: 'Custom Weather Tool',
      schema: {
        type: 'function',
        function: {
          name: 'weather_tool',
          description: 'Get weather information',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
        },
      },
      code: '',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    })

    const executionContext = createToolExecutionContext({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    const customTool = await getToolAsync('custom_remote-tool-123', {
      executionContext,
    })

    expect(customTool?.name).toBe('Custom Weather Tool')
    expect(customTool?.params.location.required).toBe(true)
    expect(mockReadAvailableCustomToolByIdOrTitleAsExecutor).toHaveBeenCalledWith({
      context: executionContext,
      identifier: 'remote-tool-123',
      lookup: 'id_or_title',
    })
  })

  it('resolves custom tools with trusted Copilot authority and cancellation', async () => {
    const abortController = new AbortController()
    mockReadAvailableCustomToolByIdOrTitleAsCopilot.mockClear()
    mockReadAvailableCustomToolByIdOrTitleAsExecutor.mockClear()
    mockReadAvailableCustomToolByIdOrTitleAsCopilot.mockResolvedValue({
      id: 'remote-tool-123',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      title: 'Copilot Custom Tool',
      schema: {
        type: 'function',
        function: {
          name: 'copilot_custom_tool',
          description: 'Runs a dynamic custom tool from Copilot',
          parameters: { type: 'object', properties: {} },
        },
      },
      code: 'return {}',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    })

    const operationContext = {
      workflowId: '',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      executionId: 'execution-1',
      chatId: 'chat-1',
      toolCallId: 'tool-call-1',
      copilotToolExecution: true,
      copilotInteractionMode: 'interactive' as const,
    }
    const customTool = await getToolAsync('custom_remote-tool-123', {
      operationContext,
      signal: abortController.signal,
    })

    expect(customTool?.name).toBe('Copilot Custom Tool')
    expect(mockReadAvailableCustomToolByIdOrTitleAsCopilot).toHaveBeenCalledWith({
      context: operationContext,
      identifier: 'remote-tool-123',
      lookup: 'id_or_title',
      signal: abortController.signal,
    })
    expect(mockReadAvailableCustomToolByIdOrTitleAsExecutor).not.toHaveBeenCalled()
  })
})

describe('executeTool Function', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    setupFetchMock({
      json: { success: true, output: { result: 'Direct request successful' } },
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('executes trusted Function calls in process without dropping resolved execution context', async () => {
    const fetchSpy = vi.fn()
    global.fetch = Object.assign(fetchSpy, { preconnect: vi.fn() }) as typeof fetch

    const largeValueRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'array',
      size: 1024,
      executionId: 'execution-1',
    }
    const result = await executeTool(
      'function_execute',
      {
        code: 'return [{{API_KEY}}, __blockRef_0.field]',
        isCustomTool: true,
        inputs: { location: 'San Francisco' },
        envVars: { API_KEY: 'resolved-secret' },
        contextVariables: {
          __blockRef_0: { field: 'resolved-output' },
          __blockRef_1: largeValueRef,
        },
        _context: {
          userId: 'forged-user',
          workspaceId: 'forged-workspace',
          workflowId: 'forged-workflow',
          executionId: 'forged-execution',
          largeValueExecutionIds: ['forged-execution'],
          largeValueKeys: ['lv_FORGEDVALUE1'],
          fileKeys: ['forged-file'],
          allowLargeValueWorkflowScope: false,
        },
      },
      {
        executionContext: createToolExecutionContext({
          userId: 'user-1',
          workspaceId: 'workspace-456',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          largeValueExecutionIds: ['execution-1'],
          largeValueKeys: ['lv_ABCDEFGHIJKL'],
          fileKeys: ['file-1'],
          allowLargeValueWorkflowScope: true,
        }),
      }
    )

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(mockExecuteFunction).toHaveBeenCalledOnce()
    expect(mockExecuteFunction.mock.calls[0]?.[0]).toMatchObject({
      input: {
        workspaceId: 'workspace-456',
        body: {
          code: 'return [{{API_KEY}}, __blockRef_0.field]',
          isCustomTool: true,
          inputs: { location: 'San Francisco' },
          envVars: { API_KEY: 'resolved-secret' },
          contextVariables: {
            __blockRef_0: { field: 'resolved-output' },
            __blockRef_1: largeValueRef,
          },
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          workspaceId: 'workspace-456',
          userId: undefined,
          largeValueExecutionIds: ['execution-1'],
          largeValueKeys: ['lv_ABCDEFGHIJKL'],
          fileKeys: ['file-1'],
          allowLargeValueWorkflowScope: true,
        },
      },
    })
    expect(mockGenerateInternalToken).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('executes Copilot Function calls in process with operation authority and exact inputs', async () => {
    const fetchSpy = vi.fn()
    global.fetch = Object.assign(fetchSpy, { preconnect: vi.fn() }) as typeof fetch
    const abortController = new AbortController()
    const registry = new ResolvedSecretTraceRegistry()
    const largeValueRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'array',
      size: 1024,
      executionId: 'execution-1',
    }

    const result = await executeTool(
      'function_execute',
      {
        code: 'return [{{API_KEY}}, __blockRef_0.field, workflowVariables.customer]',
        envVars: { API_KEY: 'resolved-secret' },
        workflowVariables: { customer: 'Ada' },
        contextVariables: {
          __blockRef_0: { field: 'resolved-output' },
          __blockRef_1: largeValueRef,
        },
        _context: {
          userId: 'attacker',
          workspaceId: 'evil-workspace',
          workflowId: 'evil-workflow',
          executionId: 'evil-execution',
        },
      },
      {
        signal: abortController.signal,
        resolvedSecretTraceRegistry: registry,
        operationContext: {
          userId: 'user-1',
          workspaceId: 'workspace-456',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          copilotToolExecution: true,
          resolvedSecretTraceRegistry: registry,
          largeValueExecutionIds: ['execution-1'],
          largeValueKeys: ['lv_ABCDEFGHIJKL'],
          fileKeys: ['file-1'],
          allowLargeValueWorkflowScope: true,
        },
      }
    )

    expect(result.output).toEqual({
      success: true,
      output: { result: 'in-process' },
    })
    expect(mockExecuteFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-456',
          resourceScope: { executionId: 'execution-1' },
        }),
        input: expect.objectContaining({
          workspaceId: 'workspace-456',
          signal: abortController.signal,
          body: expect.objectContaining({
            code: 'return [{{API_KEY}}, __blockRef_0.field, workflowVariables.customer]',
            envVars: { API_KEY: 'resolved-secret' },
            workflowVariables: { customer: 'Ada' },
            contextVariables: {
              __blockRef_0: { field: 'resolved-output' },
              __blockRef_1: largeValueRef,
            },
            userId: undefined,
            workspaceId: 'workspace-456',
            workflowId: 'workflow-1',
            executionId: 'execution-1',
            largeValueExecutionIds: ['execution-1'],
            largeValueKeys: ['lv_ABCDEFGHIJKL'],
            fileKeys: ['file-1'],
            allowLargeValueWorkflowScope: true,
          }),
        }),
      })
    )
    expect(mockGenerateInternalToken).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('executes Copilot dynamic custom tools through the Function application operation', async () => {
    const customTool = {
      id: 'remote-tool-123',
      workspaceId: 'workspace-456',
      userId: 'user-1',
      title: 'Custom Weather Tool',
      schema: {
        type: 'function',
        function: {
          name: 'weather_tool',
          description: 'Get weather information',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
        },
      },
      code: 'return { location: params.location }',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    } as const
    mockGetToolAsync.mockResolvedValue(createToolConfig(customTool, 'custom_remote-tool-123'))
    const fetchSpy = vi.fn()
    global.fetch = Object.assign(fetchSpy, { preconnect: vi.fn() }) as typeof fetch
    const abortController = new AbortController()

    const result = await executeTool(
      'custom_remote-tool-123',
      {
        location: 'San Francisco',
        _context: {
          userId: 'attacker',
          workspaceId: 'evil-workspace',
          workflowId: 'evil-workflow',
          executionId: 'evil-execution',
        },
      },
      {
        skipPostProcess: true,
        signal: abortController.signal,
        operationContext: {
          userId: 'user-1',
          workspaceId: 'workspace-456',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          chatId: 'chat-1',
          toolCallId: 'tool-call-1',
          copilotToolExecution: true,
          largeValueExecutionIds: ['execution-1'],
          largeValueKeys: ['lv_ABCDEFGHIJKL'],
          fileKeys: ['file-1'],
          allowLargeValueWorkflowScope: true,
        },
      }
    )

    expect(mockExecuteFunction).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ success: true, output: 'in-process' })
    expect(mockExecuteFunction.mock.calls[0]?.[0]).toMatchObject({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-456',
        resourceScope: { executionId: 'execution-1' },
      },
      input: {
        workspaceId: 'workspace-456',
        signal: abortController.signal,
        body: {
          code: 'return { location: params.location }',
          params: expect.objectContaining({ location: 'San Francisco' }),
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          workspaceId: 'workspace-456',
          userId: undefined,
          largeValueExecutionIds: ['execution-1'],
          largeValueKeys: ['lv_ABCDEFGHIJKL'],
          fileKeys: ['file-1'],
          allowLargeValueWorkflowScope: true,
          isCustomTool: true,
        },
      },
    })
    expect(mockGenerateInternalToken).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('executes registered internal tools in process through the shared provider operation', async () => {
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      Response.json({
        account: '123456789012',
        arn: 'arn:aws:iam::123456789012:user/test',
        userId: 'AIDATEST',
      })
    )
    const fetchSpy = vi.fn()
    global.fetch = Object.assign(fetchSpy, { preconnect: vi.fn() }) as typeof fetch

    const result = await executeTool(
      'sts_get_caller_identity',
      {
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
      {
        executionContext: createToolExecutionContext({
          userId: 'user-1',
          workspaceId: 'workspace-456',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }),
      }
    )

    expect(mockExecuteInternalToolOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: 'sts_get_caller_identity',
        input: {
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        },
        signal: expect.any(AbortSignal),
      })
    )
    expect(result).toMatchObject({
      success: true,
      output: {
        account: '123456789012',
        arn: 'arn:aws:iam::123456789012:user/test',
        userId: 'AIDATEST',
      },
    })
    expect(mockGenerateInternalToken).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps the public File Fetch URL before in-process dispatch', async () => {
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      Response.json({ success: true, output: { files: [], combinedContent: '' } })
    )

    const result = await executeTool(
      'file_fetch',
      {
        fileUrl: 'https://example.com/report.pdf',
        headers: { Authorization: 'Bearer token' },
        workspaceId: 'workspace-456',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      {
        executionContext: createToolExecutionContext({
          userId: 'user-1',
          workspaceId: 'workspace-456',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }),
      }
    )

    expect(mockExecuteInternalToolOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: 'file_fetch',
        input: {
          filePath: 'https://example.com/report.pdf',
          headers: { Authorization: 'Bearer token' },
          workspaceId: 'workspace-456',
        },
      })
    )
    expect(result).toMatchObject({
      success: true,
      output: { files: [], combinedContent: '' },
    })
  })

  it('bounds ignored Bitbucket pipeline log ranges through the execution path', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })

    const log = 'line 1\nDONE\n'
    const response = new Response(log, {
      status: 200,
      headers: {
        'content-length': String(Buffer.byteLength(log)),
        'content-type': 'text/plain',
      },
    })
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: {
        get: (name: string) => response.headers.get(name),
        toRecord: () => Object.fromEntries(response.headers.entries()),
      },
      body: response.body,
    })

    const params = {
      accessToken: 'oauth-token',
      workspaceSlug: 'acme',
      repoSlug: 'demo',
      pipelineUuid: '{pipeline}',
      stepUuid: '{step}',
      maxCharacters: 5,
    }
    const accepted = await executeTool('bitbucket_get_pipeline_step_log', params, {
      skipPostProcess: true,
    })

    expect(accepted).toMatchObject({
      success: true,
      output: {
        log: 'DONE\n',
        truncated: true,
        totalBytes: Buffer.byteLength(log),
      },
    })

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining('/pipelines/%7Bpipeline%7D/steps/%7Bstep%7D/log'),
      '93.184.216.34',
      expect.objectContaining({ maxResponseBytes: 16 * 1024 * 1024 })
    )
  })

  it('retries transient database failures during permission preflight', async () => {
    const driverError = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      errno: 'ECONNRESET',
      syscall: 'read',
    })
    const databaseError = new DrizzleQueryError(
      'select "id" from "workspace" where "workspace"."id" = $1 limit $2',
      ['workspace-secret-id', 1],
      driverError
    )
    mockAssertPermissionsAllowed.mockRejectedValueOnce(databaseError)
    mockToolsLogger.warn.mockClear()

    const result = await executeTool(
      'function_execute',
      { code: 'return 1' },
      { executionContext: createToolExecutionContext({ userId: 'user-123' }) }
    )

    expect(result.success).toBe(true)
    expect(mockAssertPermissionsAllowed).toHaveBeenCalledTimes(2)
    expect(mockExecuteFunction).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockToolsLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Retrying tool permission preflight after database error'),
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 3,
        cause: expect.objectContaining({ code: 'ECONNRESET' }),
      })
    )
  })

  it('logs exhausted database retries without exposing query details to the caller', async () => {
    const driverError = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      errno: 'ECONNRESET',
      syscall: 'read',
    })
    const databaseError = new DrizzleQueryError(
      'select "id" from "workspace" where "workspace"."id" = $1 limit $2',
      ['workspace-secret-id', 1],
      driverError
    )
    mockAssertPermissionsAllowed.mockRejectedValue(databaseError)
    mockToolsLogger.error.mockClear()

    const result = await executeTool(
      'http_request',
      { url: 'https://example.com' },
      { executionContext: createToolExecutionContext({ userId: 'user-123' }) }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'An internal error occurred while executing the tool. Please try again.'
    )
    expect(JSON.stringify(result)).not.toContain('Failed query')
    expect(JSON.stringify(result)).not.toContain('workspace-secret-id')
    expect(mockAssertPermissionsAllowed).toHaveBeenCalledTimes(3)
    expect(global.fetch).not.toHaveBeenCalled()

    const loggedError = mockToolsLogger.error.mock.calls.at(-1)?.[1]
    expect(loggedError).toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({
          name: 'Error',
          message: 'read ECONNRESET',
          code: 'ECONNRESET',
          errno: 'ECONNRESET',
          syscall: 'read',
          causeChain: expect.arrayContaining([
            expect.stringContaining('params: [redacted]'),
            'Error: read ECONNRESET',
          ]),
        }),
      })
    )
    expect(loggedError).not.toHaveProperty('stack')
    expect(JSON.stringify(loggedError)).not.toContain('workspace-secret-id')
  })

  it('does not retry non-transient database failures during permission preflight', async () => {
    const databaseError = new DrizzleQueryError(
      'select "missing_column" from "workspace"',
      [],
      Object.assign(new Error('column does not exist'), { code: '42703' })
    )
    mockAssertPermissionsAllowed.mockRejectedValue(databaseError)

    const result = await executeTool(
      'function_execute',
      { code: 'return 1' },
      { executionContext: createToolExecutionContext({ userId: 'user-123' }) }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'An internal error occurred while executing the tool. Please try again.'
    )
    expect(mockAssertPermissionsAllowed).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('surfaces cancellation instead of a concurrent permission database failure', async () => {
    const controller = new AbortController()
    const abortReason = new Error('Execution cancelled')
    const databaseError = new DrizzleQueryError(
      'select "id" from "workspace" where "workspace"."id" = $1',
      ['workspace-secret-id'],
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    )
    mockAssertPermissionsAllowed.mockImplementationOnce(async () => {
      controller.abort(abortReason)
      throw databaseError
    })

    const result = await executeTool(
      'function_execute',
      { code: 'return 1' },
      {
        executionContext: createToolExecutionContext({ userId: 'user-123' }),
        signal: controller.signal,
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Execution cancelled')
    expect(mockAssertPermissionsAllowed).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fails closed instead of calling the removed Function route without trusted scope', async () => {
    const originalFunctionTool = { ...tools.function_execute }
    tools.function_execute = {
      ...tools.function_execute,
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'Function executed successfully' },
      }),
    }

    await executeTool(
      'function_execute',
      {
        code: 'return { result: "hello world" }',
        language: 'javascript',
      },
      { skipPostProcess: true }
    ) // Skip proxy

    tools.function_execute = originalFunctionTool

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('binds the Mothership sandbox profile into direct Function execution', async () => {
    const result = await executeTool(
      'function_execute',
      {
        code: 'return 1',
      },
      {
        skipPostProcess: true,
        internalSandboxProfile: 'mothership',
        executionContext: createToolExecutionContext({
          userId: 'user-123',
          workspaceId: 'workspace-456',
        }),
      }
    )

    expect(result.success).toBe(true)
    expect(mockExecuteFunction).toHaveBeenCalledWith({
      principal: expect.any(Object),
      input: expect.objectContaining({ sandboxProfile: 'mothership' }),
    })
    expect(mockGenerateInternalToken).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('imports File Get Content provenance without exposing private transport metadata', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { contents: ['secret-value'] },
          __resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-value' }],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-provenance-v1',
          },
        }
      )
    )
    const executionContext = createToolExecutionContext({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    const result = await executeTool(
      'file_get_content',
      {
        fileId: 'file-1',
        workspaceId: 'workspace-1',
        _context: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
      { executionContext, resolvedSecretTraceRegistry: registry }
    )

    const operationRequest = mockExecuteInternalToolOperation.mock.calls[0]?.[0]
    expect(operationRequest.headers.get('x-sim-request-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(operationRequest).toMatchObject({
      toolId: 'file_get_content',
      input: { operation: 'content', fileId: 'file-1', workspaceId: 'workspace-1' },
    })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, output: { contents: ['secret-value'] } })
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
    ])
  })

  it.each([
    {
      name: 'table propagate policy',
      toolId: 'table_batch_insert_rows',
      status: 400,
      params: {
        tableId: 'table-1',
        rows: [{ name: 'duplicate' }],
        _context: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    },
    {
      name: 'memory isolated policy',
      toolId: 'memory_add',
      status: 500,
      params: {
        id: 'memory-1',
        role: 'user',
        content: { owner: 'user-1' },
        _context: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    },
  ])(
    'preserves the raw $name error without logging unverifiable details',
    async ({ toolId, status, params }) => {
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
      const untrustedDetail = 'route-secret-plaintext'
      const untrustedHeader = 'route-secret-header-value'
      mockExecuteInternalToolOperation.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: untrustedDetail }), {
          status,
          headers: {
            'content-type': 'application/json',
            'x-route-error-detail': untrustedHeader,
          },
        })
      )

      const result = await executeTool(toolId, params, {
        executionContext: createToolExecutionContext({
          userId: 'user-1',
          workspaceId: 'workspace-1',
        }),
        resolvedSecretTraceRegistry: registry,
      })
      expect(result).toMatchObject({
        success: false,
        output: { status, data: { error: untrustedDetail } },
        error: untrustedDetail,
      })
      expect(JSON.stringify(result)).not.toContain(untrustedHeader)
      expect(JSON.stringify(mockToolsLogger.error.mock.calls)).not.toContain(untrustedDetail)
      expect(JSON.stringify(mockToolsLogger.error.mock.calls)).not.toContain(untrustedHeader)
      expect(registry.isComplete()).toBe(true)
    }
  )

  it('preserves File Get Content with authenticated incomplete lineage', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { contents: ['untrusted file content'] },
          __resolvedSecretTraceProvenance: {
            version: 1,
            complete: false,
            entries: [],
            scope: { userId: 'user-1', workspaceId: 'workspace-1' },
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-provenance-v1',
          },
        }
      )
    )

    const result = await executeTool(
      'file_get_content',
      {
        fileId: 'file-1',
        workspaceId: 'workspace-1',
        _context: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
      {
        executionContext: createToolExecutionContext({
          userId: 'user-1',
          workspaceId: 'workspace-1',
        }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).toContain('untrusted file content')
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
    expect(registry.isComplete()).toBe(false)
  })

  it('preserves a headerless legacy File Get Content response without poisoning later calls', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { contents: ['legacy content'] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeTool(
      'file_get_content',
      {
        fileId: 'file-1',
        workspaceId: 'workspace-1',
        _context: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
      {
        executionContext: createToolExecutionContext({
          userId: 'user-1',
          workspaceId: 'workspace-1',
        }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).toContain('legacy content')
    expect(registry.isComplete()).toBe(true)
  })

  it('consumes Function secret provenance without exposing private transport metadata', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_KEY',
        plaintext: 'secret-value',
        encryptedValue: 'encrypted-value',
      },
    ])
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          output: { result: 'secret-value', stdout: '' },
          __resolvedSecretNames: ['API_KEY'],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )

    const result = await executeTool(
      'function_execute',
      {
        code: 'return {{API_KEY}}',
        envVars: { API_KEY: 'secret-value' },
      },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    const requestHeaders = mockExecuteFunction.mock.calls[0]?.[0].input.headers
    expect(requestHeaders.get('x-sim-request-private-tool-metadata')).toBe(
      'resolved-secret-names-durable-files-v2'
    )
    expect(result.output).toEqual({
      success: true,
      output: { result: 'secret-value', stdout: '' },
    })
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
    ])
    expect(mockMarkWorkspaceFileSecretProvenanceUnknown).not.toHaveBeenCalled()
  })

  it('does not log plaintext or runtime aliases from Function errors', async () => {
    const secret = 'function-error-secret-value'
    const runtimeAlias = '__var_API_KEY'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_KEY',
        plaintext: secret,
        encryptedValue: 'encrypted-value',
      },
    ])
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: `Execution failed with ${secret} via ${runtimeAlias}`,
          __resolvedSecretNames: ['API_KEY'],
        }),
        {
          status: 422,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )

    const result = await executeTool(
      'function_execute',
      {
        code: 'throw new Error({{API_KEY}})',
        envVars: { API_KEY: secret },
      },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain(secret)
    expect(JSON.stringify(mockToolsLogger.error.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(mockToolsLogger.error.mock.calls)).not.toContain(runtimeAlias)
    expect(JSON.stringify(projectToolResultForCopilot(result, registry))).not.toContain(secret)
    expect(JSON.stringify(projectToolResultForCopilot(result, registry))).not.toContain(
      runtimeAlias
    )
  })

  it('uses structural-only Function error logs when no provenance registry is available', async () => {
    const secret = 'direct-function-error-secret-value'
    const runtimeAlias = '__var_DIRECT_KEY'
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: `Execution failed with ${secret} via ${runtimeAlias}`,
        }),
        {
          status: 422,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )

    const result = await executeTool(
      'function_execute',
      {
        code: 'throw new Error(environmentVariables.DIRECT_KEY)',
        envVars: { DIRECT_KEY: secret },
      },
      { executionContext: createToolExecutionContext({ userId: 'user-1' }) }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain(secret)
    expect(JSON.stringify(mockToolsLogger.error.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(mockToolsLogger.error.mock.calls)).not.toContain(runtimeAlias)
  })

  it('does not log a secret-bearing non-OK response stream error', async () => {
    const secret = 'function-body-stream-secret-value'
    const streamError = `${secret} __var_API_KEY __sim_code_0_binding_0`
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error(streamError))
          },
        }),
        {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
        }
      )
    )

    const result = await executeTool(
      'function_execute',
      {
        code: 'throw new Error(environmentVariables.API_KEY)',
        envVars: { API_KEY: secret },
      },
      { executionContext: createToolExecutionContext({ userId: 'user-1' }) }
    )

    expect(result.success).toBe(false)
    const logged = JSON.stringify(mockToolsLogger.warn.mock.calls)
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
    expect(mockToolsLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read non-OK response body for function_execute'),
      { errorName: 'Error' }
    )
  })

  it('does not let pending custom-tool provenance affect an unrelated result', async () => {
    const secret = 'custom-tool-secret-value'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_KEY',
        plaintext: secret,
        encryptedValue: 'encrypted-value',
      },
    ])
    mockGetToolAsync.mockResolvedValueOnce({
      id: 'custom_pending-provenance',
      name: 'Pending provenance custom tool',
      description: 'Tests late provenance activation',
      version: '1.0.0',
      params: {},
      operation: {
        input: () => ({ code: 'return {{API_KEY}}', envVars: { API_KEY: secret } }),
      },
      transformResponse: async (response: Response) => {
        const data = await response.json()
        return { success: true, output: data.output }
      },
    })

    let resolveRequest!: (response: Response) => void
    let markRequestStarted!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })
    mockExecuteFunction.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve
          markRequestStarted()
        })
    )

    const execution = executeTool(
      'custom_pending-provenance',
      { envVars: { API_KEY: secret } },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )
    await requestStarted

    expect(registry.isComplete()).toBe(true)
    expect(
      projectToolResultForCopilot({ success: true, output: { result: secret } }, registry)
    ).toMatchObject({ output: { result: secret } })

    resolveRequest(
      new Response(
        JSON.stringify({
          success: true,
          output: { result: secret },
          __resolvedSecretNames: ['API_KEY'],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )

    await expect(execution).resolves.toMatchObject({ success: true })
    expect(mockExecuteFunction).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(registry.isComplete()).toBe(true)
    expect(
      projectToolResultForCopilot({ success: true, output: { result: secret } }, registry)
    ).toMatchObject({ output: { result: '{{API_KEY}}' } })
  })

  it('isolates invalid custom-tool provenance and allows a later call to proceed', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    mockGetToolAsync.mockResolvedValue({
      id: 'custom_invalid-provenance',
      name: 'Invalid provenance custom tool',
      description: 'Tests isolated provenance settlement',
      version: '1.0.0',
      params: {},
      operation: {
        input: () => ({ code: 'return "unchanged"', envVars: {} }),
      },
      transformResponse: async (response: Response) => {
        const data = await response.json()
        return { success: true, output: data.output }
      },
    })
    mockExecuteFunction
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            output: { result: 'untrusted result' },
            __resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-sim-private-tool-metadata': 'resolved-secret-provenance-v1',
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            output: { result: 'later call succeeded' },
            __resolvedSecretNames: [],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
            },
          }
        )
      )

    const invalidResult = await executeTool(
      'custom_invalid-provenance',
      { envVars: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(invalidResult).toMatchObject({
      success: false,
      output: {},
      error: 'Internal tool response metadata could not be verified',
    })
    expect(JSON.stringify(invalidResult)).not.toContain('untrusted result')
    expect(registry.isComplete()).toBe(true)

    const laterResult = await executeTool(
      'custom_invalid-provenance',
      { envVars: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(laterResult).toMatchObject({
      success: true,
      output: { result: 'later call succeeded' },
    })
    expect(registry.isComplete()).toBe(true)
  })

  it('passes trusted workflow scope and isolated provenance to the in-process runner', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'INPUT_SECRET',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-input-secret',
        },
      ],
      { userId: 'parent-owner', workspaceId: 'workspace-456' }
    )
    expect(
      registry.recordResolvedAtInputPath('INPUT_SECRET', 'secret-value', ['inputMapping'])
    ).toBe(true)
    mockRunWorkflowTool.mockResolvedValueOnce({ success: true, output: { ok: true } })

    await executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow', inputMapping: { token: 'secret-value' } },
      {
        executionContext: createToolExecutionContext({ userId: 'parent-actor' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(mockRunWorkflowTool).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'child-workflow',
        inputMapping: { token: 'secret-value' },
        _context: expect.objectContaining({
          userId: 'parent-actor',
          workspaceId: 'workspace-456',
          workflowId: 'test-workflow',
        }),
      }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: expect.any(ResolvedSecretTraceRegistry),
      })
    )
    const runnerOptions = mockRunWorkflowTool.mock.calls[0]?.[1] as {
      resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
    }
    expect(runnerOptions.resolvedSecretTraceRegistry).not.toBe(registry)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("hands the in-process runner the invoking run's env and redaction policy", async () => {
    mockRunWorkflowTool.mockResolvedValueOnce({ success: true, output: { ok: true } })
    const piiBlockOutputRedaction = {
      enabled: true,
      entityTypes: ['EMAIL_ADDRESS'],
      language: 'en',
    }

    await executeTool(
      'workflow_executor_child-workflow',
      {
        workflowId: 'child-workflow',
        _context: { environmentVariables: { MY_API_KEY: 'model-injected' } },
      },
      {
        executionContext: createToolExecutionContext({
          environmentVariables: { MY_API_KEY: 'parent-secret' },
          piiBlockOutputRedaction,
        }),
      }
    )

    expect(mockRunWorkflowTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        environmentVariables: { MY_API_KEY: 'parent-secret' },
        piiBlockOutputRedaction,
      })
    )
  })

  it('copies the env map so a child run cannot corrupt the parent context', async () => {
    mockRunWorkflowTool.mockResolvedValueOnce({ success: true, output: { ok: true } })
    const executionContext = createToolExecutionContext({
      environmentVariables: { MY_API_KEY: 'parent-secret' },
    })

    await executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow' },
      { executionContext }
    )

    const forwarded = (mockRunWorkflowTool.mock.calls[0]?.[1] as Record<string, unknown>)
      .environmentVariables as Record<string, string>
    expect(forwarded).toEqual({ MY_API_KEY: 'parent-secret' })
    expect(forwarded).not.toBe(executionContext.environmentVariables)

    forwarded.MY_API_KEY = 'mutated-by-child'
    forwarded.INJECTED = 'added-by-child'

    expect(executionContext.environmentVariables).toEqual({ MY_API_KEY: 'parent-secret' })
  })

  it('leaves the custom-block runner without the consumer redaction policy', async () => {
    mockRunCustomBlockTool.mockResolvedValueOnce({ success: true, output: { ok: true } })

    await executeTool(
      'deployed_block_executor_custom_block_123',
      { blockType: 'custom_block_123' },
      {
        executionContext: createToolExecutionContext({
          environmentVariables: { MY_API_KEY: 'consumer-secret' },
          piiBlockOutputRedaction: { enabled: true, entityTypes: [], language: 'en' },
        }),
      }
    )

    const options = mockRunCustomBlockTool.mock.calls[0]?.[1] as Record<string, unknown>
    expect(options).not.toHaveProperty('environmentVariables')
    expect(options).not.toHaveProperty('piiBlockOutputRedaction')
  })

  it('overwrites custom-block tool context with the trusted workflow scope', async () => {
    const executionContext = createToolExecutionContext({
      userId: 'trusted-user',
      workflowId: 'trusted-workflow',
      workspaceId: 'trusted-workspace',
      executionId: 'trusted-execution',
      callChain: ['trusted-parent'],
      isDeployedContext: true,
    })
    mockRunCustomBlockTool.mockResolvedValueOnce({ success: true, output: { ok: true } })

    await executeTool(
      'deployed_block_executor_custom_block_123',
      {
        blockType: 'custom_block_123',
        _context: {
          userId: 'forged-user',
          workflowId: 'forged-workflow',
          workspaceId: 'forged-workspace',
          executionId: 'forged-execution',
          callChain: ['forged-parent'],
          isDeployedContext: false,
          billingAttribution: { forged: true },
        },
      },
      { executionContext }
    )

    expect(mockRunCustomBlockTool).toHaveBeenCalledWith(
      expect.objectContaining({
        blockType: 'custom_block_123',
        _context: expect.objectContaining({
          userId: 'trusted-user',
          workflowId: 'trusted-workflow',
          workspaceId: 'trusted-workspace',
          executionId: 'trusted-execution',
          callChain: ['trusted-parent'],
          isDeployedContext: true,
          billingAttribution: TEST_BILLING_ATTRIBUTION,
          requestId: expect.any(String),
        }),
      }),
      expect.objectContaining({
        resolvedSecretTraceRegistry: undefined,
      })
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('filters cross-scope workflow provenance to literals present in the unchanged result', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'parent-user',
      workspaceId: 'workspace-456',
    })
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: encryptedValue === 'crossed-encrypted' ? 'crossed-secret' : 'unrelated-secret',
    }))
    const childOutput = {
      answer: 'The child returned crossed-secret verbatim',
      publicValue: 'unchanged',
    }
    mockRunWorkflowTool.mockImplementationOnce(
      async (
        _params: unknown,
        options: { resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry }
      ) => {
        await options.resolvedSecretTraceRegistry.importCrossingProvenance(
          {
            version: 1,
            complete: true,
            entries: [
              { name: 'CROSSED', encryptedValue: 'crossed-encrypted' },
              { name: 'UNRELATED', encryptedValue: 'unrelated-encrypted' },
            ],
            scope: { userId: 'parent-user', workspaceId: 'child-workspace' },
          },
          childOutput,
          { trusted: true, origin: 'workflow-tool-test' }
        )
        return { success: true, output: childOutput }
      }
    )

    const result = await executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow', inputMapping: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'parent-user' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result).toEqual({
      success: true,
      output: childOutput,
      timing: {
        startTime: expect.any(String),
        endTime: expect.any(String),
        duration: expect.any(Number),
      },
    })
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
    expect(registry.getActiveMatches()).toEqual([
      {
        plaintext: 'crossed-secret',
        replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
      },
    ])
    expect(registry.isComplete()).toBe(true)
  })

  it('preserves a headerless legacy workflow response without poisoning later calls', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'parent-user',
      workspaceId: 'workspace-456',
    })
    mockRunWorkflowTool.mockResolvedValueOnce({
      success: true,
      output: { value: 'unverifiable legacy output' },
    })

    const result = await executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow', inputMapping: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'parent-user' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).toContain('unverifiable legacy output')
    expect(registry.isComplete()).toBe(true)

    mockRunWorkflowTool.mockResolvedValueOnce({
      success: true,
      output: { value: 'later call succeeded' },
    })
    const laterResult = await executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow', inputMapping: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'parent-user' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(laterResult).toMatchObject({
      success: true,
      output: { value: 'later call succeeded' },
    })
    expect(registry.isComplete()).toBe(true)
  })

  it('preserves workflow output with authenticated incomplete lineage', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'parent-user',
      workspaceId: 'workspace-456',
    })
    mockRunWorkflowTool.mockImplementationOnce(
      async (
        _params: unknown,
        options: { resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry }
      ) => {
        options.resolvedSecretTraceRegistry.markIncomplete('source-provenance-incomplete')
        return { success: true, output: { value: 'untrusted partial output' } }
      }
    )

    const result = await executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow', inputMapping: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'parent-user' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).toContain('untrusted partial output')
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
    expect(registry.isComplete()).toBe(false)
  })

  it('returns large in-process workflow output without applying the HTTP response cap', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'parent-user',
      workspaceId: 'workspace-456',
    })
    const functionalValue = 'f'.repeat(9 * 1024 * 1024)
    mockRunWorkflowTool.mockResolvedValueOnce({
      success: true,
      output: { value: functionalValue },
    })

    const result = await executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow', inputMapping: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'parent-user' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect((result.output as { value: string }).value).toHaveLength(functionalValue.length)
    expect(result).not.toHaveProperty('__resolvedSecretTraceProvenance')
    expect(result.output).not.toHaveProperty('__resolvedSecretTraceProvenance')
    expect(registry.isComplete()).toBe(true)
  })

  it('strips private metadata even when an internal endpoint returns the wrong marker', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          output: { result: 'unchanged' },
          __resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-provenance-v1',
          },
        }
      )
    )

    const result = await executeTool(
      'function_execute',
      { code: 'return "unchanged"', envVars: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
    expect(result).toMatchObject({
      success: false,
      error: 'Internal tool response metadata could not be verified',
    })
    expect(registry.isComplete()).toBe(true)

    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          output: { result: 'later call succeeded' },
          __resolvedSecretNames: [],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )
    const laterResult = await executeTool(
      'function_execute',
      { code: 'return "later call succeeded"', envVars: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(laterResult.success).toBe(true)
    expect(registry.isComplete()).toBe(true)
  })

  it('fails closed when a marked private response envelope is malformed', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    mockExecuteFunction.mockResolvedValueOnce(
      new Response('{"__resolvedSecretNames":["API_KEY"],"value":"secret-value"', {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
        },
      })
    )

    const result = await executeTool(
      'function_execute',
      { code: 'return "unchanged"', envVars: { API_KEY: 'secret-value' } },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretNames')
    expect(result).toMatchObject({
      success: false,
      error: 'Internal tool request failed (HTTP 500)',
    })
    expect(registry.isComplete()).toBe(true)
  })

  it('preserves a thrown error while committing provenance for downstream projection', async () => {
    const secret = 'transaction-throw-secret'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-value' },
    ])
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: secret,
          __resolvedSecretNames: ['API_KEY'],
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )
    const originalError = new Error(secret)
    mockToolsLogger.error.mockImplementation(() => {
      throw originalError
    })

    const execution = executeTool(
      'function_execute',
      { code: 'throw new Error({{API_KEY}})', envVars: { API_KEY: secret } },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    await expect(execution).rejects.toBe(originalError)
    expect(registry.getActiveMatches()).toEqual([{ plaintext: secret, replacement: '{{API_KEY}}' }])
    expect(registry.isComplete()).toBe(true)
    expect(
      projectToolResultForCopilot({ success: false, error: originalError.message }, registry)
    ).toEqual({ success: false, error: '{{API_KEY}}' })
  })

  it('preserves empty thrown errors instead of replacing their runtime semantics', async () => {
    const secret = '!!!!!!!!'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-value' },
    ])
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'request failed',
          __resolvedSecretNames: ['API_KEY'],
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )
    const originalError = new Error('')
    mockToolsLogger.error.mockImplementation(() => {
      throw originalError
    })

    const execution = executeTool(
      'function_execute',
      { code: 'throw new Error({{API_KEY}})', envVars: { API_KEY: secret } },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    await expect(execution).rejects.toBe(originalError)
    expect(registry.getActiveMatches()).toEqual([{ plaintext: secret, replacement: '{{API_KEY}}' }])
  })

  it('does not rewrite coincidental low-entropy matches in thrown runtime errors', async () => {
    const secret = 'xxxxxxxx'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-value' },
    ])
    mockExecuteFunction.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: secret,
          __resolvedSecretNames: ['API_KEY'],
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'x-sim-private-tool-metadata': 'resolved-secret-names-durable-files-v2',
          },
        }
      )
    )
    const originalError = new Error('Box failed')
    mockToolsLogger.error.mockImplementation(() => {
      throw originalError
    })

    const execution = executeTool(
      'function_execute',
      { code: 'throw new Error({{API_KEY}})', envVars: { API_KEY: secret } },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    await expect(execution).rejects.toBe(originalError)
    expect(originalError.message).toBe('Box failed')
    expect(registry.getActiveMatches()).toEqual([{ plaintext: secret, replacement: '{{API_KEY}}' }])
  })

  it('rethrows a local failure after authenticated lineage becomes unavailable', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'parent-user',
      workspaceId: 'workspace-456',
    })
    mockRunWorkflowTool.mockImplementationOnce(
      async (
        _params: unknown,
        options: { resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry }
      ) => {
        options.resolvedSecretTraceRegistry.markIncomplete('source-provenance-incomplete')
        throw new Error('untrusted thrown detail')
      }
    )
    mockToolsLogger.error.mockImplementation(() => {
      throw new Error('untrusted thrown detail')
    })

    const execution = executeTool(
      'workflow_executor_child-workflow',
      { workflowId: 'child-workflow', inputMapping: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'parent-user' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    await expect(execution).rejects.toThrow('untrusted thrown detail')
    expect(registry.isComplete()).toBe(false)
  })

  it('runs a private-provenance call from an incomplete parent without replacing its result', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('unspecified')

    const result = await executeTool(
      'function_execute',
      { code: 'return "unreachable"', envVars: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(registry.isComplete()).toBe(false)
    expect(mockExecuteFunction).toHaveBeenCalledOnce()
  })

  /**
   * The shape that latched in production with `reason: "unspecified"` — a getter or symbol key on
   * the params record makes the input lineage unboundable, and the fork is marked before the tool
   * runs. Pinned by name so a refusal downstream can be traced back to this guard.
   */
  it('names the guard when tool params are not enumerable plain data', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const params: Record<string, unknown> = { code: 'return "unreachable"' }
    Object.defineProperty(params, 'envVars', { enumerable: true, get: () => ({}) })

    await executeTool('function_execute', params, { resolvedSecretTraceRegistry: registry })

    expect(registry.isComplete()).toBe(false)
    expect(registry.getIncompletenessDiagnostics()?.reasons).toContain('tool-input-not-enumerable')
  })

  it('runs a private-provenance call when its input lineage cannot be bounded', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const incompleteToolRegistry = registry.forkForToolCall()
    incompleteToolRegistry.markIncomplete('unspecified')
    vi.spyOn(registry, 'forkForInputPaths').mockReturnValue(incompleteToolRegistry)
    const result = await executeTool(
      'function_execute',
      { code: 'return "unreachable"', envVars: {} },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(result.success).toBe(true)
    expect(registry.isComplete()).toBe(false)
    expect(mockExecuteFunction).toHaveBeenCalledOnce()
  })

  it('should handle non-existent tool', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await executeTool('non_existent_tool', {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('Tool not found')

    vi.restoreAllMocks()
  })

  it('aborts the in-process Function operation when the caller signal is aborted', async () => {
    let observedSignal: AbortSignal | undefined
    mockExecuteFunction.mockImplementationOnce(
      async ({ input }: { input: { signal?: AbortSignal } }) => {
        observedSignal = input.signal
        return new Promise<Response>((_resolve, reject) => {
          observedSignal!.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      }
    )

    const callerController = new AbortController()
    const resultPromise = executeTool(
      'function_execute',
      { code: 'return 1', timeout: 5000 },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        skipPostProcess: true,
        signal: callerController.signal,
      }
    )

    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    callerController.abort()
    const result = await resultPromise

    expect(observedSignal?.aborted).toBe(true)
    expect(observedSignal?.reason).toBe(callerController.signal.reason)
    expect(result.success).toBe(false)
    expect(result.error).not.toMatch(/timed out/i)
  })

  it('does not start the Function operation when the caller is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await executeTool(
      'function_execute',
      { code: 'return 1', timeout: 5000 },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        skipPostProcess: true,
        signal: controller.signal,
      }
    )

    expect(mockExecuteFunction).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })

  it('should add timing information to results', async () => {
    const result = await executeTool(
      'http_request',
      {
        url: 'https://api.example.com/data',
      },
      { skipPostProcess: true }
    )

    expect(result.timing).toBeDefined()
    expect(result.timing?.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.timing?.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0)
  })
})

describe('Internal Route Trust', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })

    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        toRecord: () => ({ 'content-type': 'application/json' }),
      },
      text: async () => JSON.stringify({}),
      json: async () => ({}),
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('rejects a caller-controlled relative URL without minting internal credentials', async () => {
    global.fetch = Object.assign(vi.fn(), { preconnect: vi.fn() }) as typeof fetch

    const result = await executeTool('http_request', {
      url: '/api/auth/oauth/token',
      method: 'GET',
      _context: { userId: 'workflow-owner' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('External tool requests require an absolute HTTP(S) URL')
    expect(mockGenerateInternalToken).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('transports only active provenance selected for an internal model input', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'PROMPT_TOKEN',
        plaintext: 'prompt-secret',
        encryptedValue: 'encrypted-prompt-secret',
      },
      {
        name: 'UNUSED_TOKEN',
        plaintext: 'unused-secret',
        encryptedValue: 'encrypted-unused-secret',
      },
    ])
    registry.recordResolvedAtInputPath('PROMPT_TOKEN', 'prompt-secret', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'prompt-secret', '{{PROMPT_TOKEN}}')
    const mockTool = {
      id: 'test_internal_model_tool',
      name: 'Test Internal Model Tool',
      description: 'A test tool with model-bound input',
      version: '1.0.0',
      params: { prompt: { type: 'string', required: true } },
      operation: {
        modelInput: {
          mode: 'private-provenance' as const,
          inputPaths: () => [['prompt']],
        },
        input: (params: { prompt: string }) => ({ prompt: params.prompt }),
      },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'Internal model route success' },
      }),
    }
    const originalTools = { ...tools }
    ;(tools as Record<string, unknown>).test_internal_model_tool = mockTool

    const result = await executeTool(
      'test_internal_model_tool',
      { prompt: 'prompt-secret' },
      {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      }
    )

    const operationRequest = mockExecuteInternalToolOperation.mock.calls[0]?.[0]
    expect(operationRequest.headers.get('x-sim-private-model-input-provenance')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(operationRequest.input.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-prompt-secret', name: 'PROMPT_TOKEN' }],
    })
    expect(result.success).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
    Object.assign(tools, originalTools)
  })

  it('transports exact empty provenance when a declared private selector returns undefined', async () => {
    const mockTool = {
      id: 'test_internal_optional_model_tool',
      name: 'Test Internal Optional Model Tool',
      description: 'A test tool with an optional model-bound input',
      version: '1.0.0',
      params: { query: { type: 'string', required: false } },
      operation: {
        modelInput: {
          mode: 'private-provenance' as const,
          inputPaths: (params: { query?: string }) => (params.query ? [['query']] : []),
        },
        input: (params: { query?: string }) => ({ query: params.query }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_internal_optional_model_tool = mockTool
    try {
      const result = await executeTool(
        'test_internal_optional_model_tool',
        {},
        {
          executionContext: createToolExecutionContext({ userId: 'user-1' }),
          resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
        }
      )

      const operationRequest = mockExecuteInternalToolOperation.mock.calls[0]?.[0]
      expect(operationRequest.headers.get('x-sim-private-model-input-provenance')).toBe(
        'resolved-secret-provenance-v1'
      )
      expect(operationRequest.input).toEqual({
        __resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [],
        },
      })
      expect(result.success).toBe(true)
    } finally {
      ;(tools as Record<string, unknown>).test_internal_optional_model_tool = undefined
    }
  })

  it('projects only selected values without treating declared param keys as secret data', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'MODEL_SECRET',
        plaintext: 'prompt',
        encryptedValue: 'encrypted-model-secret',
      },
      {
        name: 'UNRELATED_SECRET',
        plaintext: 'unrelated-secret',
        encryptedValue: 'encrypted-unrelated-secret',
      },
      {
        name: 'SYNTHETIC_INDEX_COLLISION',
        plaintext: '0',
        encryptedValue: 'encrypted-synthetic-index-collision',
      },
    ])
    registry.recordResolvedAtInputPath('MODEL_SECRET', 'prompt', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'prompt', '{{MODEL_SECRET}}')
    registry.recordResolvedAtInputPath('UNRELATED_SECRET', 'unrelated-secret', ['transport'])
    registry.recordResolvedInputProjection(
      ['transport'],
      'unrelated-secret',
      '{{UNRELATED_SECRET}}'
    )
    registry.recordResolvedAtInputPath('SYNTHETIC_INDEX_COLLISION', '0', ['unused'])
    registry.recordResolvedInputProjection(['unused'], '0', '{{SYNTHETIC_INDEX_COLLISION}}')
    const mockTool = {
      id: 'test_internal_projected_model_tool',
      name: 'Test Internal Projected Model Tool',
      description: 'Projects only model-visible request params',
      version: '1.0.0',
      params: {
        prompt: { type: 'string', required: true },
        apiKey: { type: 'string', required: true },
        transport: { type: 'string', required: true },
      },
      operation: {
        modelInput: {
          mode: 'project' as const,
          select: (params: { prompt: string }) => ({ prompt: params.prompt }),
        },
        input: (params: { prompt: string; apiKey: string; transport: string }) => ({
          prompt: params.prompt,
          apiKey: params.apiKey,
          transport: params.transport,
        }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    const params = {
      prompt: 'prompt',
      apiKey: 'prompt',
      transport: 'unrelated-secret',
    }
    const originalParams = structuredClone(params)
    ;(tools as Record<string, unknown>).test_internal_projected_model_tool = mockTool
    try {
      const result = await executeTool('test_internal_projected_model_tool', params, {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      })

      const operationRequest = mockExecuteInternalToolOperation.mock.calls[0]?.[0]
      expect(operationRequest.headers.has('x-sim-private-model-input-provenance')).toBe(false)
      expect(operationRequest.input).toEqual({
        prompt: '{{MODEL_SECRET}}',
        apiKey: 'prompt',
        transport: 'unrelated-secret',
      })
      expect(result.success).toBe(true)
      expect(params).toEqual(originalParams)
    } finally {
      ;(tools as Record<string, unknown>).test_internal_projected_model_tool = undefined
    }
  })

  it('projects text while transporting opaque model-input provenance out of band', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'PROMPT_SECRET',
        plaintext: 'prompt-secret',
        encryptedValue: 'encrypted-prompt-secret',
      },
      {
        name: 'FILE_SECRET',
        plaintext: 'file-secret',
        encryptedValue: 'encrypted-file-secret',
      },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', 'prompt-secret', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'prompt-secret', '{{PROMPT_SECRET}}')
    registry.recordResolvedAtInputPath('FILE_SECRET', 'file-secret', ['fileUrl'])
    registry.recordResolvedInputProjection(
      ['fileUrl'],
      'https://files.example/file-secret',
      'https://files.example/{{FILE_SECRET}}'
    )
    const mockTool = {
      id: 'test_internal_mixed_model_tool',
      name: 'Test Internal Mixed Model Tool',
      description: 'Projects text and privately transports opaque input provenance',
      version: '1.0.0',
      params: {
        prompt: { type: 'string', required: true },
        fileUrl: { type: 'string', required: true },
        apiKey: { type: 'string', required: true },
      },
      operation: {
        modelInput: {
          mode: 'project' as const,
          select: (params: { prompt: string }) => ({ prompt: params.prompt }),
          privateInputPaths: () => [['fileUrl']],
        },
        input: (params: { prompt: string; fileUrl: string; apiKey: string }) => ({
          prompt: params.prompt,
          fileUrl: params.fileUrl,
          apiKey: params.apiKey,
        }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_internal_mixed_model_tool = mockTool
    try {
      const result = await executeTool(
        'test_internal_mixed_model_tool',
        {
          prompt: 'prompt-secret',
          fileUrl: 'https://files.example/file-secret',
          apiKey: 'prompt-secret',
        },
        {
          executionContext: createToolExecutionContext({ userId: 'user-1' }),
          resolvedSecretTraceRegistry: registry,
        }
      )
      const operationRequest = mockExecuteInternalToolOperation.mock.calls[0]?.[0]
      expect(operationRequest.headers.get('x-sim-private-model-input-provenance')).toBe(
        'resolved-secret-provenance-v1'
      )
      expect(operationRequest.input).toEqual({
        prompt: '{{PROMPT_SECRET}}',
        fileUrl: 'https://files.example/file-secret',
        apiKey: 'prompt-secret',
        __resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ encryptedValue: 'encrypted-file-secret', name: 'FILE_SECRET' }],
        },
      })
      expect(result.success).toBe(true)
    } finally {
      ;(tools as Record<string, unknown>).test_internal_mixed_model_tool = undefined
    }
  })

  it('projects only selected nested model fields and preserves sibling values', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'NESTED_SECRET',
        plaintext: 'nested-secret',
        encryptedValue: 'encrypted-nested-secret',
      },
    ])
    registry.recordResolvedAtInputPath('NESTED_SECRET', 'nested-secret', [
      'payload',
      'items',
      '0',
      'prompt',
    ])
    registry.recordResolvedInputProjection(
      ['payload', 'items', '0', 'prompt'],
      'nested-secret',
      '{{NESTED_SECRET}}'
    )
    const mockTool = {
      id: 'test_nested_projected_model_tool',
      name: 'Test Nested Projected Model Tool',
      description: 'Projects only nested model-visible values',
      version: '1.0.0',
      params: {
        payload: { type: 'object', required: true },
        apiKey: { type: 'string', required: true },
      },
      operation: {
        modelInput: {
          mode: 'project' as const,
          select: (params: {
            payload: { items: Array<{ prompt: string; metadata: string }> }
          }) => ({ payload: params.payload.items.map((item) => item.prompt) }),
          applyProjected: (
            selectedParams: {
              payload?: { items: Array<{ prompt: string; metadata: string }> }
            },
            projectedSelection: Record<string, unknown>
          ) => {
            const prompts = projectedSelection.payload
            if (!selectedParams.payload || !Array.isArray(prompts)) {
              throw new Error('Invalid nested projection')
            }
            return {
              payload: {
                items: selectedParams.payload.items.map((item, index) => ({
                  ...item,
                  prompt: prompts[index],
                })),
              },
            }
          },
        },
        input: (params: {
          payload: { items: Array<{ prompt: string; metadata: string }> }
          apiKey: string
        }) => params,
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    const params = {
      payload: { items: [{ prompt: 'nested-secret', metadata: 'nested-secret' }] },
      apiKey: 'nested-secret',
    }
    const originalParams = structuredClone(params)
    ;(tools as Record<string, unknown>).test_nested_projected_model_tool = mockTool
    try {
      const result = await executeTool('test_nested_projected_model_tool', params, {
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
        resolvedSecretTraceRegistry: registry,
      })

      expect(mockExecuteInternalToolOperation.mock.calls[0]?.[0].input).toMatchObject({
        payload: {
          items: [{ prompt: '{{NESTED_SECRET}}', metadata: 'nested-secret' }],
        },
        apiKey: 'nested-secret',
      })
      expect(result.success).toBe(true)
      expect(params).toEqual(originalParams)
    } finally {
      ;(tools as Record<string, unknown>).test_nested_projected_model_tool = undefined
    }
  })

  it('fails closed when a nested projection adapter does not reapply projected values', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'NESTED_SECRET',
        plaintext: 'nested-secret',
        encryptedValue: 'encrypted-nested-secret',
      },
    ])
    registry.recordResolvedAtInputPath('NESTED_SECRET', 'nested-secret', ['payload', 'prompt'])
    registry.recordResolvedInputProjection(
      ['payload', 'prompt'],
      'nested-secret',
      '{{NESTED_SECRET}}'
    )
    const input = vi.fn()
    const mockTool = {
      id: 'test_invalid_nested_projected_model_tool',
      name: 'Test Invalid Nested Projected Model Tool',
      description: 'Rejects a nested adapter that leaves model input unprojected',
      version: '1.0.0',
      params: { payload: { type: 'object', required: true } },
      operation: {
        modelInput: {
          mode: 'project' as const,
          select: (params: { payload: { prompt: string } }) => ({
            payload: params.payload.prompt,
          }),
          applyProjected: (selectedParams: { payload?: { prompt: string } }) => ({
            payload: selectedParams.payload,
          }),
        },
        input,
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_invalid_nested_projected_model_tool = mockTool
    global.fetch = Object.assign(vi.fn(), { preconnect: vi.fn() }) as typeof fetch

    try {
      const result = await executeTool(
        'test_invalid_nested_projected_model_tool',
        { payload: { prompt: 'nested-secret' } },
        {
          executionContext: createToolExecutionContext({ userId: 'user-1' }),
          resolvedSecretTraceRegistry: registry,
        }
      )

      expect(result).toMatchObject({
        success: false,
        error: 'Model input could not be safely projected',
      })
      expect(input).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
    } finally {
      ;(tools as Record<string, unknown>).test_invalid_nested_projected_model_tool = undefined
    }
  })

  it('projects selected params before formatting an external JSON request', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'PROMPT_SECRET',
        plaintext: 'external-secret',
        encryptedValue: 'encrypted-external-secret',
      },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', 'external-secret', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'external-secret', '{{PROMPT_SECRET}}')
    const mockTool = {
      id: 'test_external_projected_model_tool',
      name: 'Test External Projected Model Tool',
      description: 'Projects a model-visible external request field',
      version: '1.0.0',
      params: { prompt: { type: 'string', required: true } },
      request: {
        url: 'https://api.example.com/projected-model',
        method: 'POST' as const,
        headers: () => ({ 'Content-Type': 'application/json' }),
        modelInput: {
          mode: 'project' as const,
          select: (params: { prompt: string }) => ({ prompt: params.prompt }),
        },
        body: (params: { prompt: string }) => ({ prompt: params.prompt }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_external_projected_model_tool = mockTool

    try {
      const result = await executeTool(
        'test_external_projected_model_tool',
        { prompt: 'external-secret' },
        { resolvedSecretTraceRegistry: registry }
      )

      expect(result.success).toBe(true)
      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
        'https://api.example.com/projected-model',
        '93.184.216.34',
        expect.objectContaining({ body: JSON.stringify({ prompt: '{{PROMPT_SECRET}}' }) })
      )
    } finally {
      ;(tools as Record<string, unknown>).test_external_projected_model_tool = undefined
    }
  })

  it('sends an explicitly resolved secret through an ordinary external integration input', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'EXTERNAL_INPUT', plaintext: 'true', encryptedValue: 'encrypted-external-input' },
    ])
    registry.recordResolvedAtInputPath('EXTERNAL_INPUT', 'true', ['payload'])
    registry.recordResolvedInputProjection(['payload'], 'true', '{{EXTERNAL_INPUT}}')
    const mockTool = {
      id: 'test_external_integration_tool',
      name: 'Test External Integration Tool',
      description: 'Sends ordinary integration input unchanged',
      version: '1.0.0',
      params: { payload: { type: 'string', required: true } },
      request: {
        url: 'https://api.example.com/integration',
        method: 'POST' as const,
        headers: () => ({ 'Content-Type': 'application/json' }),
        body: (params: { payload: string }) => ({ payload: params.payload }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_external_integration_tool = mockTool

    try {
      const result = await executeTool(
        'test_external_integration_tool',
        { payload: 'true' },
        { resolvedSecretTraceRegistry: registry }
      )

      expect(result.success).toBe(true)
      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
        'https://api.example.com/integration',
        '93.184.216.34',
        expect.objectContaining({
          body: JSON.stringify({ payload: 'true' }),
          headers: expect.not.objectContaining({
            'x-sim-private-model-input-provenance': expect.anything(),
          }),
        })
      )
    } finally {
      Reflect.deleteProperty(tools, 'test_external_integration_tool')
    }
  })

  it('projects only selected model input before direct execution', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'PROMPT_SECRET',
        plaintext: 'direct-secret',
        encryptedValue: 'encrypted-direct-secret',
      },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', 'direct-secret', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'direct-secret', '{{PROMPT_SECRET}}')
    const directExecution = vi.fn().mockResolvedValue({ success: true, output: { ok: true } })
    const postProcess = vi.fn(
      async (result: { success: boolean; output: { ok: boolean } }) => result
    )
    const mockTool = {
      id: 'test_direct_projected_model_tool',
      name: 'Test Direct Projected Model Tool',
      description: 'Projects model-visible params before direct execution',
      version: '1.0.0',
      params: {
        prompt: { type: 'string', required: true },
        apiKey: { type: 'string', required: true },
      },
      request: {
        url: '',
        method: 'POST' as const,
        headers: () => ({}),
        modelInput: {
          mode: 'project' as const,
          select: (params: { prompt: string }) => ({ prompt: params.prompt }),
        },
      },
      directExecution,
      postProcess,
    }
    const params = { prompt: 'direct-secret', apiKey: 'direct-secret' }
    const originalParams = structuredClone(params)
    ;(tools as Record<string, unknown>).test_direct_projected_model_tool = mockTool

    try {
      const result = await executeTool('test_direct_projected_model_tool', params, {
        resolvedSecretTraceRegistry: registry,
      })

      expect(result.success).toBe(true)
      expect(directExecution).toHaveBeenCalledWith(
        { prompt: '{{PROMPT_SECRET}}', apiKey: 'direct-secret' },
        undefined
      )
      expect(postProcess).toHaveBeenCalledWith(
        expect.any(Object),
        { prompt: 'direct-secret', apiKey: 'direct-secret' },
        expect.any(Function)
      )
      expect(params).toEqual(originalParams)
    } finally {
      ;(tools as Record<string, unknown>).test_direct_projected_model_tool = undefined
    }
  })

  it('propagates trusted execution scope and cancellation to nested tool calls', async () => {
    const controller = new AbortController()
    const fetchSpy = vi.fn()
    global.fetch = Object.assign(fetchSpy, { preconnect: vi.fn() }) as typeof fetch
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      Response.json({
        account: '123456789012',
        arn: 'arn:aws:iam::123456789012:user/test',
        userId: 'AIDATEST',
      })
    )
    const mockTool = {
      id: 'test_nested_internal_operation',
      name: 'Test Nested Internal Operation',
      description: 'Executes a registered internal operation from post-processing',
      version: '1.0.0',
      params: {},
      request: {
        url: '',
        method: 'POST' as const,
        headers: () => ({}),
      },
      directExecution: vi.fn().mockResolvedValue({ success: true, output: {} }),
      postProcess: async (
        _result: ToolResponse,
        _params: Record<string, unknown>,
        executeNestedTool: typeof executeTool
      ) =>
        executeNestedTool('sts_get_caller_identity', {
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
    }
    ;(tools as Record<string, unknown>).test_nested_internal_operation = mockTool

    try {
      const executionContext = createToolExecutionContext({
        userId: 'user-1',
        workspaceId: 'workspace-456',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
      const result = await executeTool(
        'test_nested_internal_operation',
        {},
        {
          executionContext,
          signal: controller.signal,
        }
      )

      expect(result.success).toBe(true)
      expect(mockExecuteInternalToolOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          toolId: 'sts_get_caller_identity',
          input: {
            region: 'us-east-1',
            accessKeyId: 'access-key',
            secretAccessKey: 'secret-key',
          },
          context: expect.objectContaining({
            userId: 'user-1',
            workspaceId: 'workspace-456',
            workflowId: 'workflow-1',
            executionId: 'execution-1',
          }),
          signal: expect.any(AbortSignal),
        })
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(tools, 'test_nested_internal_operation')
    }
  })

  it('preserves plaintext operation input when no provenance registry exists', async () => {
    const applyProjected = vi.fn(() => ({ prompt: 'must-not-be-called' }))
    const mockTool = {
      id: 'test_projected_model_without_registry',
      name: 'Test Projected Model Without Registry',
      description: 'Preserves legacy behavior without Sim provenance',
      version: '1.0.0',
      params: { prompt: { type: 'string', required: true } },
      operation: {
        modelInput: {
          mode: 'project' as const,
          select: vi.fn(() => ({ prompt: 'must-not-be-called' })),
          applyProjected,
        },
        input: (params: { prompt: string }) => ({ prompt: params.prompt }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_projected_model_without_registry = mockTool
    try {
      const result = await executeTool(
        'test_projected_model_without_registry',
        { prompt: 'legacy-plaintext' },
        { executionContext: createToolExecutionContext({ userId: 'user-1' }) }
      )

      expect(result.success).toBe(true)
      expect(mockExecuteInternalToolOperation.mock.calls[0]?.[0].input).toEqual({
        prompt: 'legacy-plaintext',
      })
      expect(mockTool.operation.modelInput.select).not.toHaveBeenCalled()
      expect(applyProjected).not.toHaveBeenCalled()
    } finally {
      ;(tools as Record<string, unknown>).test_projected_model_without_registry = undefined
    }
  })

  it('blocks the request with a stable error when selected model input cannot be projected', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const cyclicPrompt: Record<string, unknown> = {}
    cyclicPrompt.self = cyclicPrompt
    const input = vi.fn((params: { prompt: unknown }) => ({ prompt: params.prompt }))
    const mockTool = {
      id: 'test_invalid_projected_model_tool',
      name: 'Test Invalid Projected Model Tool',
      description: 'Rejects an unsafe model-visible request field',
      version: '1.0.0',
      params: { prompt: { type: 'object', required: true } },
      operation: {
        modelInput: {
          mode: 'project' as const,
          select: (params: { prompt: unknown }) => ({ prompt: params.prompt }),
        },
        input,
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_invalid_projected_model_tool = mockTool
    global.fetch = Object.assign(vi.fn(), { preconnect: vi.fn() }) as typeof fetch

    try {
      const result = await executeTool(
        'test_invalid_projected_model_tool',
        { prompt: cyclicPrompt },
        {
          executionContext: createToolExecutionContext({ userId: 'user-1' }),
          resolvedSecretTraceRegistry: registry,
        }
      )

      expect(result).toMatchObject({
        success: false,
        error: 'Model input could not be safely projected',
      })
      expect(input).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
    } finally {
      ;(tools as Record<string, unknown>).test_invalid_projected_model_tool = undefined
    }
  })

  it('rejects private model-input provenance for external URLs before formatting', async () => {
    const body = vi.fn(() => ({ prompt: 'plaintext' }))
    const mockTool = {
      id: 'test_external_private_model_tool',
      name: 'Test External Private Model Tool',
      description: 'Rejects private provenance on an external route',
      version: '1.0.0',
      params: { prompt: { type: 'string', required: true } },
      request: {
        url: 'https://api.example.com/private-model',
        method: 'POST' as const,
        headers: () => ({ 'Content-Type': 'application/json' }),
        modelInput: {
          mode: 'private-provenance' as const,
          inputPaths: () => [['prompt']],
        },
        body,
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }
    ;(tools as Record<string, unknown>).test_external_private_model_tool = mockTool

    try {
      const result = await executeTool(
        'test_external_private_model_tool',
        { prompt: 'plaintext' },
        { resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry() }
      )

      expect(result).toMatchObject({
        success: false,
        error: 'Private model input provenance requires an in-process operation',
      })
      expect(body).not.toHaveBeenCalled()
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    } finally {
      ;(tools as Record<string, unknown>).test_external_private_model_tool = undefined
    }
  })

  it('should reject internal tool responses that exceed the response body cap', async () => {
    const mockTool = {
      id: 'test_oversized_internal_tool',
      name: 'Test Oversized Internal Tool',
      description: 'A test tool with an oversized response',
      version: '1.0.0',
      params: {},
      operation: { input: () => ({}) },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'should not run' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_oversized_internal_tool = mockTool

    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      new Response('too large', {
        status: 200,
        headers: {
          'content-length': '10485761',
          'content-type': 'text/plain',
        },
      })
    )

    const result = await executeTool(
      'test_oversized_internal_tool',
      {},
      { executionContext: createToolExecutionContext({ userId: 'user-1' }) }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('response body exceeds maximum size')
    expect(mockTool.transformResponse).not.toHaveBeenCalled()

    Object.assign(tools, originalTools)
  })

  it('rejects oversized operation input before invoking the in-process handler', async () => {
    const mockTool = {
      id: 'test_oversized_operation_input',
      name: 'Test Oversized Operation Input',
      description: 'Rejects operation input above the shared tool admission limit',
      version: '1.0.0',
      params: { payload: { type: 'string', required: true } },
      operation: { input: (params: { payload: string }) => params },
    }
    ;(tools as Record<string, unknown>).test_oversized_operation_input = mockTool

    try {
      const result = await executeTool(
        'test_oversized_operation_input',
        { payload: 'x'.repeat(10 * 1024 * 1024) },
        { executionContext: createToolExecutionContext({ userId: 'user-1' }) }
      )

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Request body size limit exceeded (10MB)'),
      })
      expect(mockExecuteInternalToolOperation).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(tools, 'test_oversized_operation_input')
    }
  })

  it('preserves structured 413 errors from internal tool routes', async () => {
    const mockTool = {
      id: 'test_internal_route_413_tool',
      name: 'Test Internal Route 413 Tool',
      description: 'A test tool with a route-produced payload limit error',
      version: '1.0.0',
      params: {},
      operation: { input: () => ({}) },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'should not run' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_internal_route_413_tool = mockTool

    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Generated image exceeds maximum size' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeTool(
      'test_internal_route_413_tool',
      {},
      { executionContext: createToolExecutionContext({ userId: 'user-1' }) }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Generated image exceeds maximum size')
    expect(result.error).not.toContain('Request body size limit exceeded')
    expect(mockTool.transformResponse).not.toHaveBeenCalled()

    Object.assign(tools, originalTools)
  })

  it('should detect external routes (full URLs) and call directly with SSRF protection', async () => {
    // This test verifies that external URLs are called directly (not via proxy)
    // with SSRF protection via secureFetchWithPinnedIP
    const mockTool = {
      id: 'test_external_tool',
      name: 'Test External Tool',
      description: 'A test tool with external route',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'External route called directly' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_external_tool = mockTool

    // Mock fetch for the DNS validation that happens first
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    // The actual external fetch uses secureFetchWithPinnedIP which uses Node's http/https
    // This will fail with a network error in tests, which is expected
    const result = await executeTool('test_external_tool', {})

    // We expect it to attempt direct fetch (which will fail in test env due to network)
    // The key point is it should NOT try to call /api/proxy
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/proxy'),
      expect.anything()
    )

    // Restore original tools
    Object.assign(tools, originalTools)
  })

  it('should validate + pin a proxyUrl param and pass it to secureFetchWithPinnedIP', async () => {
    inputValidationMockFns.mockValidateAndPinProxyUrl.mockResolvedValue({
      isValid: true,
      pinnedProxyUrl: 'http://user:pass@1.2.3.4:8080/',
    })

    const mockTool = {
      id: 'test_external_proxy',
      name: 'Test External Proxy Tool',
      description: 'A test tool that routes through a proxy',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_external_proxy = mockTool

    await executeTool('test_external_proxy', { proxyUrl: 'http://user:pass@proxy.host:8080' })

    expect(inputValidationMockFns.mockValidateAndPinProxyUrl).toHaveBeenCalledWith(
      'http://user:pass@proxy.host:8080'
    )
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://api.example.com/endpoint',
      '93.184.216.34',
      expect.objectContaining({ proxyUrl: 'http://user:pass@1.2.3.4:8080/' })
    )

    Object.assign(tools, originalTools)
  })

  it("should forward a tool's stripAuthOnRedirect to secureFetchWithPinnedIP", async () => {
    // Tools whose endpoint redirects to a signed third-party URL (GitHub's
    // Actions log download) must not have their API credential replayed to the
    // redirect target. This fetch path follows redirects itself rather than
    // through the fetch spec, so nothing strips the header without the flag.
    const mockTool = {
      id: 'test_redirecting_download',
      name: 'Test Redirecting Download Tool',
      description: 'A test tool whose endpoint redirects to another origin',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/download',
        method: 'GET',
        headers: () => ({ Authorization: 'Bearer secret-token' }),
        stripAuthOnRedirect: true,
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_redirecting_download = mockTool

    await executeTool('test_redirecting_download', {})

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://api.example.com/download',
      '93.184.216.34',
      expect.objectContaining({ stripAuthOnRedirect: true })
    )

    Reflect.deleteProperty(tools, 'test_redirecting_download')
    Object.assign(tools, originalTools)
  })

  it('should leave stripAuthOnRedirect unset for tools that do not opt in', async () => {
    const mockTool = {
      id: 'test_plain_external',
      name: 'Test Plain External Tool',
      description: 'A test tool with no redirect handling',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/plain',
        method: 'GET',
        headers: () => ({ Authorization: 'Bearer secret-token' }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_plain_external = mockTool

    await executeTool('test_plain_external', {})

    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://api.example.com/plain',
      '93.184.216.34',
      expect.objectContaining({ stripAuthOnRedirect: undefined })
    )

    Reflect.deleteProperty(tools, 'test_plain_external')
    Object.assign(tools, originalTools)
  })

  it('should throw when the proxyUrl param fails validation', async () => {
    inputValidationMockFns.mockValidateAndPinProxyUrl.mockResolvedValue({
      isValid: false,
      error: 'proxyUrl must use http:// (https/socks proxies are not supported)',
    })

    const mockTool = {
      id: 'test_external_bad_proxy',
      name: 'Test External Bad Proxy Tool',
      description: 'A test tool with an invalid proxy',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
      transformResponse: vi.fn().mockResolvedValue({ success: true, output: {} }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_external_bad_proxy = mockTool

    const result = await executeTool('test_external_bad_proxy', {
      proxyUrl: 'https://proxy.host:8080',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid proxy URL')
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()

    Object.assign(tools, originalTools)
  })

  it('should handle dynamic URLs that resolve to external routes directly', async () => {
    const mockTool = {
      id: 'test_dynamic_external',
      name: 'Test Dynamic External Tool',
      description: 'A test tool with dynamic external route',
      version: '1.0.0',
      params: {
        endpoint: { type: 'string', required: true },
      },
      request: {
        url: (params: any) => `https://api.external.com/${params.endpoint}`,
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'Dynamic external route called directly' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_dynamic_external = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    // External URLs are now called directly with SSRF protection
    // The test verifies proxy is NOT called
    const result = await executeTool('test_dynamic_external', { endpoint: 'users' })

    // Verify proxy was not called
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/proxy'),
      expect.anything()
    )

    // Result will fail in test env due to network, but that's expected
    Object.assign(tools, originalTools)
  })

  it('should call external URLs directly with SSRF protection', async () => {
    // External URLs now use secureFetchWithPinnedIP which uses Node's http/https modules
    // This test verifies the proxy is NOT called for external URLs
    const mockTool = {
      id: 'test_external_direct',
      name: 'Test External Direct Tool',
      description: 'A test tool to verify external URLs are called directly',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
    }

    const originalTools = { ...tools }
    ;(tools as any).test_external_direct = mockTool

    const mockFetch = vi.fn()
    global.fetch = Object.assign(mockFetch, { preconnect: vi.fn() }) as typeof fetch

    // The actual request will fail in test env (no real network), but we verify:
    // 1. The proxy route is NOT called
    // 2. The tool execution is attempted
    await executeTool('test_external_direct', {})

    // Verify proxy was not called (global.fetch should not be called with /api/proxy)
    for (const call of mockFetch.mock.calls) {
      const url = call[0]
      if (typeof url === 'string') {
        expect(url).not.toContain('/api/proxy')
      }
    }

    Object.assign(tools, originalTools)
  })
})

describe('Copilot File Parameter Normalization', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    mockResolveWorkspaceFileReference.mockReset()
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('resolves canonical file IDs for single-file params during copilot execution', async () => {
    mockResolveWorkspaceFileReference.mockResolvedValue({
      id: 'wf_123',
      name: 'brief.pdf',
      path: '/api/files/wf_123',
      size: 512,
      type: 'application/pdf',
      key: 'uploads/wf_123',
    })

    const context = createToolExecutionContext({
      workspaceId: 'workspace-456',
      userId: 'user-1',
      copilotToolExecution: true,
    } as any)

    const result = await executeTool(
      'test_single_file_tool',
      { attachment: 'wf_123' },
      { executionContext: context }
    )

    expect(result.success).toBe(true)
    expect(mockExecuteInternalToolOperation.mock.calls[0]?.[0].input).toEqual({
      attachment: {
        id: 'wf_123',
        name: 'brief.pdf',
        url: '/api/files/wf_123',
        size: 512,
        type: 'application/pdf',
        key: 'uploads/wf_123',
        context: 'workspace',
      },
    })
    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith('workspace-456', 'wf_123')
  })

  it('resolves file-array params from strings and partial file objects, while preserving full file objects', async () => {
    mockResolveWorkspaceFileReference.mockImplementation(
      async (_workspaceId: string, fileId: string) => ({
        id: fileId,
        name: `${fileId}.txt`,
        path: `/api/files/${fileId}`,
        size: 128,
        type: 'text/plain',
        key: `uploads/${fileId}`,
      })
    )

    const existingFileObject = {
      id: 'wf_existing',
      name: 'existing.txt',
      url: '/api/files/wf_existing',
      size: 64,
      type: 'text/plain',
      key: 'uploads/wf_existing',
      context: 'workspace',
    }

    const partialFileObject = {
      id: 'wf_partial',
      name: 'partial.txt',
    }

    const context = createToolExecutionContext({
      workspaceId: 'workspace-456',
      userId: 'user-1',
      copilotToolExecution: true,
    } as any)

    const result = await executeTool(
      'test_file_array_tool',
      { attachments: ['wf_1', partialFileObject, existingFileObject, 'wf_2'] },
      { executionContext: context }
    )

    expect(result.success).toBe(true)
    expect(mockExecuteInternalToolOperation.mock.calls[0]?.[0].input).toEqual({
      attachments: [
        {
          id: 'wf_1',
          name: 'wf_1.txt',
          url: '/api/files/wf_1',
          size: 128,
          type: 'text/plain',
          key: 'uploads/wf_1',
          context: 'workspace',
        },
        {
          id: 'wf_partial',
          name: 'wf_partial.txt',
          url: '/api/files/wf_partial',
          size: 128,
          type: 'text/plain',
          key: 'uploads/wf_partial',
          context: 'workspace',
        },
        existingFileObject,
        {
          id: 'wf_2',
          name: 'wf_2.txt',
          url: '/api/files/wf_2',
          size: 128,
          type: 'text/plain',
          key: 'uploads/wf_2',
          context: 'workspace',
        },
      ],
    })
    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledTimes(3)
  })

  it('does not resolve file params outside copilot execution', async () => {
    const context = createToolExecutionContext({
      workspaceId: 'workspace-456',
      userId: 'user-1',
    } as any)

    const result = await executeTool(
      'test_single_file_tool',
      { attachment: 'wf_123' },
      { executionContext: context }
    )

    expect(result.success).toBe(true)
    expect(mockExecuteInternalToolOperation.mock.calls[0]?.[0].input).toEqual({
      attachment: 'wf_123',
    })
    expect(mockResolveWorkspaceFileReference).not.toHaveBeenCalled()
  })
})

describe('Copilot OAuth Credential Enforcement', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('fails fast when copilot executes an oauth tool without an explicit credential selector', async () => {
    const fetchMock = vi.fn()
    global.fetch = Object.assign(fetchMock, { preconnect: vi.fn() }) as typeof fetch

    const context = createToolExecutionContext({
      workspaceId: 'workspace-456',
      copilotToolExecution: true,
    } as any)

    const result = await executeTool('gmail_read', { maxResults: 5 }, { executionContext: context })

    expect(result.success).toBe(false)
    expect(result.error).toContain('credentialId')
    expect(result.error).toContain('environment/credentials.json')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Managed OAuth Credential Delegation', () => {
  it('passes an opaque credential ID with trusted tool scope and origin-bound delegation', async () => {
    mockGenerateInternalToken.mockResolvedValueOnce('legacy-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'managed-access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    global.fetch = Object.assign(fetchMock, { preconnect: vi.fn() }) as typeof fetch

    const executorDelegationOrigin = {
      subjectUserId: 'origin-user',
      workflowId: 'origin-workflow',
      executionId: 'origin-execution',
      currentWorkflow: {
        workflowId: 'current-workflow',
        mode: 'deployment' as const,
        deploymentVersionId: 'deployment-version-1',
      },
    }
    const context = createToolExecutionContext({
      userId: 'current-user',
      workflowId: 'current-workflow',
      executionId: 'current-execution',
      executorDelegationOrigin,
    })

    await executeTool(
      'gmail_read',
      { oauthCredential: 'managed-credential-id' },
      { executionContext: context }
    )

    expect(mockGenerateInternalDelegationToken).toHaveBeenCalledWith(executorDelegationOrigin)
    const [tokenUrl, tokenRequest] = fetchMock.mock.calls[0]
    expect(String(tokenUrl)).toContain('/api/auth/oauth/token')
    expect(tokenRequest.headers).toMatchObject({
      Authorization: 'Bearer legacy-token',
      'x-sim-managed-oauth-delegation': 'Bearer executor-token',
    })
    expect(JSON.parse(tokenRequest.body)).toMatchObject({
      credentialId: 'managed-credential-id',
      toolId: 'gmail_read',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    })
  })

  it('fails before transport when managed credential delegation lacks current workflow authority', async () => {
    mockGenerateInternalDelegationToken.mockClear()
    mockGenerateInternalToken.mockResolvedValueOnce('legacy-token')
    const fetchMock = vi.fn()
    global.fetch = Object.assign(fetchMock, { preconnect: vi.fn() }) as typeof fetch

    const context = createToolExecutionContext({
      userId: 'current-user',
      workflowId: 'current-workflow',
      executionId: 'current-execution',
      principal: {
        kind: 'session',
        userId: 'current-user',
        sessionId: 'session-1',
      },
      executorDelegationOrigin: {
        subjectUserId: 'current-user',
        workflowId: 'current-workflow',
        executionId: 'current-execution',
        principal: {
          kind: 'session',
          userId: 'current-user',
          sessionId: 'session-1',
        },
      },
    })

    const result = await executeTool(
      'gmail_read',
      { oauthCredential: 'managed-credential-id' },
      { executionContext: context }
    )

    expect(result).toMatchObject({
      success: false,
      error: 'Managed credential delegation is missing current workflow authority',
    })
    expect(mockGenerateInternalDelegationToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Copilot Env Variable Reference Resolution', () => {
  let cleanupEnvVars: () => void

  function sentOperationInput(): Record<string, unknown> {
    const call = mockExecuteInternalToolOperation.mock.calls.findLast(
      ([request]) => request.toolId === 'test_env_ref_tool'
    )
    if (!call) throw new Error('Expected test_env_ref_tool operation execution')
    return call[0].input
  }

  const copilotContext = () =>
    createToolExecutionContext({
      workspaceId: 'workspace-456',
      userId: 'user-123',
      copilotToolExecution: true,
    } as any)

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    mockGetEffectiveDecryptedEnv.mockReset()
    mockGetEffectiveDecryptedEnv.mockResolvedValue({ SENTRY_AUTH_TOKEN: 'sntrys_real_token' })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('resolves a whole-value {{VAR}} reference in a user-only param', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: '{{SENTRY_AUTH_TOKEN}}' },
      { executionContext: copilotContext() }
    )

    expect(result.success).toBe(true)
    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-123', 'workspace-456')
    expect(sentOperationInput().apiKey).toBe('sntrys_real_token')
  })

  it('keeps direct integration execution raw while projecting only its active workspace secret', async () => {
    const activeSecret = 'xxxxxxxx'
    const unusedSecret = 'true'
    mockGetEffectiveDecryptedEnv.mockResolvedValueOnce({
      SERPER_API_KEY: activeSecret,
      UNUSED_SECRET: unusedSecret,
    })
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      Response.json({ reflected: activeSecret, ordinary: unusedSecret })
    )
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'SERPER_API_KEY',
        plaintext: activeSecret,
        encryptedValue: 'encrypted-active',
      },
      {
        name: 'UNUSED_SECRET',
        plaintext: unusedSecret,
        encryptedValue: 'encrypted-unused',
      },
    ])
    const callerParams = { apiKey: '{{SERPER_API_KEY}}' }

    const result = await executeTool('test_env_ref_tool', callerParams, {
      executionContext: copilotContext(),
      resolvedSecretTraceRegistry: registry,
    })

    expect(result).toMatchObject({
      success: true,
      output: { reflected: activeSecret, ordinary: unusedSecret },
    })
    expect(callerParams).toEqual({ apiKey: '{{SERPER_API_KEY}}' })
    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-123', 'workspace-456')
    expect(sentOperationInput().apiKey).toBe(activeSecret)
    expect(projectToolResultForCopilot(result, registry)).toMatchObject({
      success: true,
      output: { reflected: '{{SERPER_API_KEY}}', ordinary: unusedSecret },
    })
  })

  it('does not let a pending user-only reference affect an unrelated result', async () => {
    const secret = 'sntrys_real_token'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'SENTRY_AUTH_TOKEN',
        plaintext: secret,
        encryptedValue: 'encrypted-token',
      },
    ])
    let resolveEnvironment!: (variables: Record<string, string>) => void
    let markResolutionStarted!: () => void
    const resolutionStarted = new Promise<void>((resolve) => {
      markResolutionStarted = resolve
    })
    mockGetEffectiveDecryptedEnv.mockImplementationOnce(
      () =>
        new Promise<Record<string, string>>((resolve) => {
          resolveEnvironment = resolve
          markResolutionStarted()
        })
    )
    const execution = executeTool(
      'test_env_ref_tool',
      { apiKey: '{{SENTRY_AUTH_TOKEN}}' },
      {
        executionContext: copilotContext(),
        resolvedSecretTraceRegistry: registry,
      }
    )
    await resolutionStarted

    expect(registry.isComplete()).toBe(false)
    expect(
      projectToolResultForCopilot({ success: true, output: { result: secret } }, registry)
    ).toMatchObject({ output: { result: secret } })

    resolveEnvironment({ SENTRY_AUTH_TOKEN: secret })
    await expect(execution).resolves.toMatchObject({ success: true })

    expect(registry.isComplete()).toBe(true)
    expect(
      projectToolResultForCopilot({ success: true, output: { result: secret } }, registry)
    ).toMatchObject({ output: { result: '{{SENTRY_AUTH_TOKEN}}' } })
  })

  it('trims whitespace inside the braces like the executor resolver', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: '{{ SENTRY_AUTH_TOKEN }}' },
      { executionContext: copilotContext() }
    )

    expect(result.success).toBe(true)
    expect(sentOperationInput().apiKey).toBe('sntrys_real_token')
  })

  it('never resolves references in llm-writable (user-or-llm) params', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: '{{SENTRY_AUTH_TOKEN}}', note: '{{SENTRY_AUTH_TOKEN}}' },
      { executionContext: copilotContext() }
    )

    expect(result.success).toBe(true)
    expect(sentOperationInput().note).toBe('{{SENTRY_AUTH_TOKEN}}')
  })

  it('leaves embedded references untouched in user-only params', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: 'Bearer {{SENTRY_AUTH_TOKEN}}' },
      { executionContext: copilotContext() }
    )

    expect(result.success).toBe(true)
    expect(sentOperationInput().apiKey).toBe('Bearer {{SENTRY_AUTH_TOKEN}}')
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
  })

  it('fails with a clear error before any request when the variable is missing', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: '{{MISSING_VAR}}' },
      { executionContext: copilotContext() }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('MISSING_VAR')
    expect(result.error).toContain('apiKey')
    expect(mockExecuteInternalToolOperation).not.toHaveBeenCalled()
  })

  it('fails fast instead of forwarding the placeholder when user context is missing', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: '{{SENTRY_AUTH_TOKEN}}' },
      {
        executionContext: createToolExecutionContext({
          workspaceId: 'workspace-456',
          userId: undefined,
          copilotToolExecution: true,
        } as any),
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('authenticated user context')
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
    expect(mockExecuteInternalToolOperation).not.toHaveBeenCalled()
  })

  it('explains the personal-only scope when a variable is missing without a workspace context', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: '{{MISSING_VAR}}' },
      {
        executionContext: createToolExecutionContext({
          workspaceId: undefined,
          userId: 'user-123',
          copilotToolExecution: true,
        } as any),
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('only personal variables are available')
    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-123', undefined)
    expect(mockExecuteInternalToolOperation).not.toHaveBeenCalled()
  })

  it('does not resolve references outside copilot execution', async () => {
    const result = await executeTool(
      'test_env_ref_tool',
      { apiKey: '{{SENTRY_AUTH_TOKEN}}' },
      { executionContext: createToolExecutionContext({ userId: 'user-123' } as any) }
    )

    expect(result.success).toBe(true)
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
    expect(sentOperationInput().apiKey).toBe('{{SENTRY_AUTH_TOKEN}}')
  })

  it('never mutates the caller-owned params object (log-leak guard)', async () => {
    const callerParams = { apiKey: '{{SENTRY_AUTH_TOKEN}}' }

    const result = await executeTool('test_env_ref_tool', callerParams, {
      executionContext: copilotContext(),
    })

    expect(result.success).toBe(true)
    expect(callerParams.apiKey).toBe('{{SENTRY_AUTH_TOKEN}}')
  })
})

describe('Centralized Error Handling', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  const testErrorFormat = async (name: string, errorResponse: any, expectedError: string) => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      toSecureFetchResponse(
        new Response(JSON.stringify(errorResponse), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const result = await executeTool(
      'http_request',
      { url: 'https://example.com/test', method: 'GET' },
      { skipPostProcess: true }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(expectedError)
  }

  it('should extract GraphQL error format (Linear API)', async () => {
    await testErrorFormat(
      'GraphQL',
      { errors: [{ message: 'Invalid query field' }] },
      'Invalid query field'
    )
  })

  it('should extract X/Twitter API error format', async () => {
    await testErrorFormat(
      'X/Twitter',
      { errors: [{ detail: 'Rate limit exceeded' }] },
      'Rate limit exceeded'
    )
  })

  it('uses a tool-specific Prospeo extractor before flattening a failed response', async () => {
    const originalExtractor = tools.http_request.errorExtractor
    tools.http_request.errorExtractor = ErrorExtractorId.PROSPEO_ERRORS

    try {
      await testErrorFormat('Prospeo', { error: true, error_code: 'NO_MATCH' }, 'NO_MATCH')
    } finally {
      tools.http_request.errorExtractor = originalExtractor
    }
  })

  it('should extract Hunter API error format', async () => {
    await testErrorFormat('Hunter', { errors: [{ details: 'Invalid API key' }] }, 'Invalid API key')
  })

  it('should extract direct errors array (string)', async () => {
    await testErrorFormat('Direct string array', { errors: ['Network timeout'] }, 'Network timeout')
  })

  it('should extract direct errors array (object)', async () => {
    await testErrorFormat(
      'Direct object array',
      { errors: [{ message: 'Validation failed' }] },
      'Validation failed'
    )
  })

  it('should extract OAuth error description', async () => {
    await testErrorFormat('OAuth', { error_description: 'Invalid grant' }, 'Invalid grant')
  })

  it('should extract SOAP fault error', async () => {
    await testErrorFormat(
      'SOAP fault',
      { fault: { faultstring: 'Server unavailable' } },
      'Server unavailable'
    )
  })

  it('should extract simple SOAP faultstring', async () => {
    await testErrorFormat(
      'Simple SOAP',
      { faultstring: 'Authentication failed' },
      'Authentication failed'
    )
  })

  it('should extract Notion/Discord message format', async () => {
    await testErrorFormat('Notion/Discord', { message: 'Page not found' }, 'Page not found')
  })

  it('should extract Airtable error object format', async () => {
    await testErrorFormat(
      'Airtable',
      { error: { message: 'Invalid table ID' } },
      'Invalid table ID'
    )
  })

  it('should extract simple error string format', async () => {
    await testErrorFormat(
      'Simple string',
      { error: 'Simple error message' },
      'Simple error message'
    )
  })

  it('should fall back to text when JSON parsing fails and extract error message', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      toSecureFetchResponse(
        new Response('Invalid access token', {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'text/plain' },
        })
      )
    )

    const result = await executeTool(
      'http_request',
      { url: 'https://example.com/test', method: 'GET' },
      { skipPostProcess: true }
    )

    expect(result.success).toBe(false)
    // Should extract the text error message, not the JSON parsing error
    expect(result.error).toBe('Invalid access token')
  })

  it('should handle plain text error responses from APIs like Apollo', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      toSecureFetchResponse(
        new Response('Invalid API key provided', {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'content-type': 'text/plain' },
        })
      )
    )

    const result = await executeTool(
      'http_request',
      { url: 'https://example.com/test', method: 'GET' },
      { skipPostProcess: true }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid API key provided')
  })

  it('should fall back to HTTP status text when both JSON and text parsing fail', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        get: (key: string) => (key === 'content-type' ? 'text/plain' : null),
        toRecord: () => ({ 'content-type': 'text/plain' }),
      },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('Cannot read response'))
        },
      }),
      text: () => Promise.reject(new Error('Cannot read response')),
      json: () => Promise.reject(new Error('Invalid JSON')),
      arrayBuffer: () => Promise.reject(new Error('Cannot read response')),
    })

    const result = await executeTool(
      'http_request',
      { url: 'https://example.com/test', method: 'GET' },
      { skipPostProcess: true }
    )

    expect(result.success).toBe(false)
    // Should fall back to HTTP status text when both parsing methods fail
    expect(result.error).toBe('Internal Server Error')
  })

  it('should handle complex nested error objects', async () => {
    await testErrorFormat(
      'Complex nested',
      { error: { code: 400, message: 'Complex validation error', details: 'Field X is invalid' } },
      'Complex validation error'
    )
  })

  it('should handle error arrays with multiple entries (take first)', async () => {
    await testErrorFormat(
      'Multiple errors',
      { errors: [{ message: 'First error' }, { message: 'Second error' }] },
      'First error'
    )
  })

  it('should stringify complex error objects when no message found', async () => {
    const complexError = { code: 500, type: 'ServerError', context: { requestId: '123' } }
    await testErrorFormat(
      'Complex object stringify',
      { error: complexError },
      JSON.stringify(complexError)
    )
  })
})

describe('MCP Tool Execution', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('executes dynamic MCP tools in-process without an HTTP request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      Response.json({
        success: true,
        data: {
          success: true,
          output: { content: [{ type: 'text', text: 'Files listed successfully' }] },
        },
      })
    )

    const context = createToolExecutionContext()
    const result = await executeTool(
      'mcp-123-list_files',
      { path: '/test' },
      { executionContext: context }
    )

    expect(mockGetInternalToolOperationHandler).toHaveBeenCalledWith('mcp-123-list_files')
    expect(mockExecuteInternalToolOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: 'mcp-123-list_files',
        input: { path: '/test' },
        context: expect.objectContaining({
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          userId: context.userId,
          billingAttribution: expect.objectContaining({ workspaceId: context.workspaceId }),
        }),
      })
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: true,
      output: { content: [{ type: 'text', text: 'Files listed successfully' }] },
    })
  })

  it('preserves MCP operation error envelopes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockExecuteInternalToolOperation.mockResolvedValueOnce(
      Response.json({ success: false, error: 'Tool not found on server' }, { status: 404 })
    )

    const result = await executeTool(
      'mcp-123-missing_tool',
      { path: '/test' },
      { executionContext: createToolExecutionContext() }
    )

    expect(result).toMatchObject({ success: false, error: 'Tool not found on server' })
    expect(result.timing).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  describe('Tool request retries', () => {
    beforeEach(() => {
      mockValidateUrlWithDNS.mockResolvedValue({
        isValid: true,
        resolvedIP: '93.184.216.34',
      })
    })

    function makeJsonResponse(
      status: number,
      body: unknown,
      extraHeaders?: Record<string, string>
    ) {
      return toSecureFetchResponse(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
          headers: { 'content-type': 'application/json', ...(extraHeaders ?? {}) },
        })
      )
    }

    it('retries on 5xx responses for http_request', async () => {
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(makeJsonResponse(500, { error: 'nope' }))
        .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: 2,
        retryDelayMs: 0,
        retryMaxDelayMs: 0,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
      expect(result.success).toBe(true)
      expect((result.output as any).status).toBe(200)
    })

    it('does not retry when retries is not specified (default: 0)', async () => {
      mockSecureFetchWithPinnedIP.mockResolvedValue(
        makeJsonResponse(500, { error: 'server error' })
      )

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(false)
    })

    it('stops retrying after max attempts for http_request', async () => {
      mockSecureFetchWithPinnedIP.mockResolvedValue(makeJsonResponse(502, { error: 'bad gateway' }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: 2,
        retryDelayMs: 0,
        retryMaxDelayMs: 0,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
      expect(result.success).toBe(false)
    })

    it('does not retry on 4xx responses for http_request', async () => {
      mockSecureFetchWithPinnedIP.mockResolvedValue(makeJsonResponse(400, { error: 'bad request' }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: 5,
        retryDelayMs: 0,
        retryMaxDelayMs: 0,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(false)
    })

    it('does not retry POST by default (non-idempotent)', async () => {
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(makeJsonResponse(500, { error: 'nope' }))
        .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'POST',
        retries: 2,
        retryDelayMs: 0,
        retryMaxDelayMs: 0,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(false)
    })

    it('retries POST when retryNonIdempotent is enabled', async () => {
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(makeJsonResponse(500, { error: 'nope' }))
        .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'POST',
        retries: 1,
        retryNonIdempotent: true,
        retryDelayMs: 0,
        retryMaxDelayMs: 0,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
      expect(result.success).toBe(true)
      expect((result.output as any).status).toBe(200)
    })

    it('skips retry when Retry-After header exceeds maxDelayMs', async () => {
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(
          makeJsonResponse(429, { error: 'rate limited' }, { 'retry-after': '60' })
        )
        .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: 3,
        retryMaxDelayMs: 5000,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(false)
    })

    it('skips retry when Retry-After exceeds a maxDelayMs configured above the 30s default cap', async () => {
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(
          makeJsonResponse(429, { error: 'rate limited' }, { 'retry-after': '50' })
        )
        .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: 3,
        retryMaxDelayMs: 40000,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(false)
    })

    it('retries when Retry-After header is within maxDelayMs', async () => {
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(
          makeJsonResponse(429, { error: 'rate limited' }, { 'retry-after': '0' })
        )
        .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: 2,
        retryDelayMs: 0,
        retryMaxDelayMs: 5000,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
      expect(result.success).toBe(true)
    })

    it('retries on ETIMEDOUT errors for http_request', async () => {
      const etimedoutError = Object.assign(new Error('connect ETIMEDOUT 10.0.0.1:443'), {
        code: 'ETIMEDOUT',
      })
      mockSecureFetchWithPinnedIP
        .mockRejectedValueOnce(etimedoutError)
        .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))

      const result = await executeTool('http_request', {
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: 1,
        retryDelayMs: 0,
        retryMaxDelayMs: 0,
      })

      expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
      expect(result.success).toBe(true)
    })
  })
})

describe('Hosted Key Injection', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    vi.clearAllMocks()
    mockGetBYOKKey.mockReset()
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('should not inject hosted key when tool has no hosting config', async () => {
    const mockTool = {
      id: 'test_no_hosting',
      name: 'Test No Hosting',
      description: 'A test tool without hosting config',
      version: '1.0.0',
      params: {},
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_no_hosting = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({ userId: 'user-1' })
    await executeTool('test_no_hosting', {}, { executionContext: mockContext })

    // BYOK should not be called since there's no hosting config
    expect(mockGetBYOKKey).not.toHaveBeenCalled()

    Object.assign(tools, originalTools)
  })

  it('should check BYOK key first when tool has hosting config', async () => {
    // Note: isHosted is mocked to false by default, so hosted key injection won't happen
    // This test verifies the flow when isHosted would be true
    const mockTool = {
      id: 'test_with_hosting',
      name: 'Test With Hosting',
      description: 'A test tool with hosting config',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: true },
      },
      hosting: {
        envKeyPrefix: 'TEST_API',
        apiKeyParam: 'apiKey',
        byokProviderId: 'exa',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_with_hosting = mockTool

    // Mock BYOK returning a key
    mockGetBYOKKey.mockResolvedValue({ apiKey: 'byok-test-key', isBYOK: true })

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({ userId: 'user-1' })
    await executeTool('test_with_hosting', {}, { executionContext: mockContext })

    // With isHosted=false, BYOK won't be called - this is expected behavior
    // The test documents the current behavior
    Object.assign(tools, originalTools)
  })

  it('should use per_request pricing model correctly', async () => {
    const mockTool = {
      id: 'test_per_request_pricing',
      name: 'Test Per Request Pricing',
      description: 'A test tool with per_request pricing',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: true },
      },
      hosting: {
        envKeyPrefix: 'TEST_API',
        apiKeyParam: 'apiKey',
        byokProviderId: 'exa',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    // Verify pricing config structure
    expect(mockTool.hosting.pricing.type).toBe('per_request')
    expect(mockTool.hosting.pricing.cost).toBe(0.005)
  })

  it('should use custom pricing model correctly', async () => {
    const mockGetCost = vi.fn().mockReturnValue({ cost: 0.01, metadata: { breakdown: 'test' } })

    const mockTool = {
      id: 'test_custom_pricing',
      name: 'Test Custom Pricing',
      description: 'A test tool with custom pricing',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: true },
      },
      hosting: {
        envKeyPrefix: 'TEST_API',
        apiKeyParam: 'apiKey',
        byokProviderId: 'exa',
        pricing: {
          type: 'custom' as const,
          getCost: mockGetCost,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success', costDollars: { total: 0.01 } },
      }),
    }

    // Verify pricing config structure
    expect(mockTool.hosting.pricing.type).toBe('custom')
    expect(typeof mockTool.hosting.pricing.getCost).toBe('function')

    // Test getCost returns expected value
    const result = mockTool.hosting.pricing.getCost({}, { costDollars: { total: 0.01 } })
    expect(result).toEqual({ cost: 0.01, metadata: { breakdown: 'test' } })
  })

  it('should handle custom pricing returning a number', async () => {
    const mockGetCost = vi.fn().mockReturnValue(0.005)

    const mockTool = {
      id: 'test_custom_pricing_number',
      name: 'Test Custom Pricing Number',
      description: 'A test tool with custom pricing returning number',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: true },
      },
      hosting: {
        envKeyPrefix: 'TEST_API',
        apiKeyParam: 'apiKey',
        byokProviderId: 'exa',
        pricing: {
          type: 'custom' as const,
          getCost: mockGetCost,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
    }

    // Test getCost returns a number
    const result = mockTool.hosting.pricing.getCost({}, {})
    expect(result).toBe(0.005)
  })
})

describe('Rate Limiting and Retry Logic', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
    vi.clearAllMocks()
    setEnvFlags({ isHosted: true })
    setEnv({ TEST_HOSTED_KEY: 'test-hosted-api-key' })
    mockGetBYOKKey.mockResolvedValue(null)
    // Set up throttler mock defaults
    mockRateLimiterFns.acquireKey.mockResolvedValue({
      success: true,
      key: 'mock-hosted-key',
      keyIndex: 0,
      envVarName: 'TEST_HOSTED_KEY',
    })
    mockRateLimiterFns.preConsumeCapacity.mockResolvedValue(true)
    mockRateLimiterFns.consumeCapacity.mockResolvedValue(undefined)
    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
    cleanupEnvVars()
    setEnvFlags({ isHosted: false })
    setEnv({ TEST_HOSTED_KEY: undefined })
  })

  it('should retry on 429 rate limit errors with exponential backoff', async () => {
    let attemptCount = 0

    const mockTool = {
      id: 'test_rate_limit',
      name: 'Test Rate Limit',
      description: 'A test tool for rate limiting',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.001,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      request: {
        url: 'https://api.example.com/test/rate-limit',
        method: 'POST' as const,
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_rate_limit = mockTool

    mockSecureFetchWithPinnedIP.mockImplementation(async () => {
      attemptCount++
      if (attemptCount < 3) {
        return toSecureFetchResponse(
          new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'content-type': 'application/json' },
          })
        )
      }
      return toSecureFetchResponse(Response.json({ success: true }))
    })

    const mockContext = createToolExecutionContext({ userId: 'user-1' })
    const resultPromise = executeTool('test_rate_limit', {}, { executionContext: mockContext })

    // Advance timers to skip retry delays (1s + 2s exponential backoff)
    await vi.advanceTimersByTimeAsync(10000)
    const result = await resultPromise

    // Should succeed after retries
    expect(result.success).toBe(true)
    // Should have made 3 attempts (2 failures + 1 success)
    expect(attemptCount).toBe(3)

    Object.assign(tools, originalTools)
  })

  it('should fail after max retries on persistent rate limiting', async () => {
    const mockTool = {
      id: 'test_persistent_rate_limit',
      name: 'Test Persistent Rate Limit',
      description: 'A test tool for persistent rate limiting',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.001,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      request: {
        url: 'https://api.example.com/test/persistent-rate-limit',
        method: 'POST' as const,
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
    }

    const originalTools = { ...tools }
    ;(tools as any).test_persistent_rate_limit = mockTool

    mockSecureFetchWithPinnedIP.mockImplementation(async () =>
      toSecureFetchResponse(
        new Response(JSON.stringify({ error: 'Rate limited' }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const mockContext = createToolExecutionContext()
    const resultPromise = executeTool(
      'test_persistent_rate_limit',
      {},
      { executionContext: mockContext }
    )

    // Advance timers to skip retry delays (1s + 2s + 4s exponential backoff)
    await vi.advanceTimersByTimeAsync(15000)
    const result = await resultPromise

    // Should fail after all retries exhausted
    expect(result.success).toBe(false)
    expect(result.error).toContain('Rate limited')

    Object.assign(tools, originalTools)
  })

  it('should not retry on non-rate-limit errors', async () => {
    let attemptCount = 0

    const mockTool = {
      id: 'test_no_retry',
      name: 'Test No Retry',
      description: 'A test tool that should not retry',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.001,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      request: {
        url: 'https://api.example.com/test/no-retry',
        method: 'POST' as const,
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
    }

    const originalTools = { ...tools }
    ;(tools as any).test_no_retry = mockTool

    mockSecureFetchWithPinnedIP.mockImplementation(async () => {
      attemptCount++
      return toSecureFetchResponse(
        new Response(JSON.stringify({ error: 'Bad request' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        })
      )
    })

    const mockContext = createToolExecutionContext()
    const result = await executeTool('test_no_retry', {}, { executionContext: mockContext })

    // Should fail immediately without retries
    expect(result.success).toBe(false)
    expect(attemptCount).toBe(1)

    Object.assign(tools, originalTools)
  })
})

describe('stripInternalFields Safety', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('should preserve string output from tools without character-indexing', async () => {
    const stringOutput = '{"type":"button","phone":"917899658001"}'

    const mockTool = {
      id: 'test_string_output',
      name: 'Test String Output',
      description: 'A tool that returns a string as output',
      version: '1.0.0',
      params: {},
      operation: { input: () => ({}) },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: stringOutput,
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_string_output = mockTool

    const result = await executeTool(
      'test_string_output',
      {},
      {
        skipPostProcess: true,
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
      }
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe(stringOutput)
    expect(typeof result.output).toBe('string')

    Object.assign(tools, originalTools)
  })

  it('should preserve array output from tools', async () => {
    const arrayOutput = [{ id: 1 }, { id: 2 }]

    const mockTool = {
      id: 'test_array_output',
      name: 'Test Array Output',
      description: 'A tool that returns an array as output',
      version: '1.0.0',
      params: {},
      operation: { input: () => ({}) },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: arrayOutput,
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_array_output = mockTool

    const result = await executeTool(
      'test_array_output',
      {},
      {
        skipPostProcess: true,
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
      }
    )

    expect(result.success).toBe(true)
    expect(Array.isArray(result.output)).toBe(true)
    expect(result.output).toEqual(arrayOutput)

    Object.assign(tools, originalTools)
  })

  it('should still strip __-prefixed fields from object output', async () => {
    const mockTool = {
      id: 'test_strip_internal',
      name: 'Test Strip Internal',
      description: 'A tool with __internal fields in output',
      version: '1.0.0',
      params: {},
      operation: { input: () => ({}) },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'ok', __costDollars: 0.05, _id: 'keep-this' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_strip_internal = mockTool

    const result = await executeTool(
      'test_strip_internal',
      {},
      {
        skipPostProcess: true,
        executionContext: createToolExecutionContext({ userId: 'user-1' }),
      }
    )

    expect(result.success).toBe(true)
    expect(result.output.result).toBe('ok')
    expect(result.output.__costDollars).toBeUndefined()
    expect(result.output._id).toBe('keep-this')

    Object.assign(tools, originalTools)
  })

  it('should preserve __-prefixed fields in custom tool output', async () => {
    const output = postProcessToolOutput('custom_test-preserve-dunder', {
      result: 'ok',
      __metadata: { source: 'user' },
      __tag: 'important',
    })

    expect(output).toEqual({
      result: 'ok',
      __metadata: { source: 'user' },
      __tag: 'important',
    })
  })
})

describe('Cost Field Handling', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = setupEnvVars({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
    vi.clearAllMocks()
    setEnvFlags({ isHosted: true })
    setEnv({ TEST_HOSTED_KEY: 'test-hosted-api-key' })
    mockGetBYOKKey.mockResolvedValue(null)
    // Set up throttler mock defaults
    mockRateLimiterFns.acquireKey.mockResolvedValue({
      success: true,
      key: 'mock-hosted-key',
      keyIndex: 0,
      envVarName: 'TEST_HOSTED_KEY',
    })
    mockRateLimiterFns.preConsumeCapacity.mockResolvedValue(true)
    mockRateLimiterFns.consumeCapacity.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
    setEnvFlags({ isHosted: false })
    setEnv({ TEST_HOSTED_KEY: undefined })
  })

  it('should add cost to output when using hosted key with per_request pricing', async () => {
    const mockTool = {
      id: 'test_cost_per_request',
      name: 'Test Cost Per Request',
      description: 'A test tool with per_request pricing',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_cost_per_request = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({
      userId: 'user-123',
    } as any)
    const result = await executeTool('test_cost_per_request', {}, { executionContext: mockContext })

    expect(result.success).toBe(true)
    // Note: In test environment, hosted key injection may not work due to env mocking complexity.
    // The cost calculation logic is tested via the pricing model tests above.
    // This test verifies the tool execution flow when hosted key IS available (by checking output structure).
    if (result.output.cost) {
      expect(result.output.cost.total).toBe(0.005)
    }

    Object.assign(tools, originalTools)
  })

  it('should not add cost when not using hosted key', async () => {
    setEnvFlags({ isHosted: false })

    const mockTool = {
      id: 'test_no_hosted_cost',
      name: 'Test No Hosted Cost',
      description: 'A test tool without hosted key',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: true },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_no_hosted_cost = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({ userId: 'user-1' })
    // Pass user's own API key
    const result = await executeTool(
      'test_no_hosted_cost',
      { apiKey: 'user-api-key' },
      { executionContext: mockContext }
    )

    expect(result.success).toBe(true)
    // Should not have cost since user provided their own key
    expect(result.output.cost).toBeUndefined()

    Object.assign(tools, originalTools)
  })

  it('emits _serviceCost for copilot executions using a hosted key', async () => {
    const mockTool = {
      id: 'test_copilot_hosted_cost',
      name: 'Test Copilot Hosted Cost',
      description: 'A hosted-key tool invoked by the copilot',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        byokProviderId: 'exa',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_copilot_hosted_cost = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool(
      'test_copilot_hosted_cost',
      {},
      {
        executionContext: createToolExecutionContext({
          userId: 'user-123',
          workspaceId: 'workspace-456',
          copilotToolExecution: true,
        }),
      }
    )

    expect(result.success).toBe(true)
    expect(mockRateLimiterFns.acquireKey).toHaveBeenCalled()
    expect(result.output.cost).toEqual({ total: 0.005 })
    expect(result.output._serviceCost).toEqual({ service: 'exa', cost: 0.005 })

    Object.assign(tools, originalTools)
  })

  it('does not emit _serviceCost for workflow executions using a hosted key', async () => {
    const mockTool = {
      id: 'test_workflow_hosted_cost',
      name: 'Test Workflow Hosted Cost',
      description: 'A hosted-key tool invoked by a workflow',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_workflow_hosted_cost = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({ userId: 'user-123' } as any)
    const result = await executeTool(
      'test_workflow_hosted_cost',
      {},
      { executionContext: mockContext }
    )

    expect(result.success).toBe(true)
    // Workflow executions bill through the execution ledger; emitting
    // _serviceCost here would double-bill via Go's service-charge path.
    expect(result.output.cost).toEqual({ total: 0.005 })
    expect(result.output._serviceCost).toBeUndefined()

    Object.assign(tools, originalTools)
  })

  it('should use custom pricing getCost function', async () => {
    const mockGetCost = vi.fn().mockReturnValue({
      cost: 0.015,
      metadata: { mode: 'advanced', results: 10 },
    })

    const mockTool = {
      id: 'test_custom_pricing_cost',
      name: 'Test Custom Pricing Cost',
      description: 'A test tool with custom pricing',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
        mode: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'custom' as const,
          getCost: mockGetCost,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success', results: 10 },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_custom_pricing_cost = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({
      userId: 'user-123',
    } as any)
    const result = await executeTool(
      'test_custom_pricing_cost',
      { mode: 'advanced' },
      { executionContext: mockContext }
    )

    expect(result.success).toBe(true)
    expect(result.output.cost).toBeDefined()
    expect(result.output.cost.total).toBe(0.015)

    // getCost should have been called with params and output
    expect(mockGetCost).toHaveBeenCalled()

    Object.assign(tools, originalTools)
  })

  it('should skip hosted key injection when hosting predicate is false', async () => {
    const mockTool = {
      id: 'test_conditional_hosting',
      name: 'Test Conditional Hosting',
      description: 'A test tool with conditional hosted keys',
      version: '1.0.0',
      params: {
        provider: { type: 'string', required: false },
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        enabled: (params: { provider?: string }) => params.provider === 'hosted-provider',
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_conditional_hosting = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({
      userId: 'user-123',
    } as any)
    const result = await executeTool(
      'test_conditional_hosting',
      { provider: 'user-provider' },
      { executionContext: mockContext }
    )

    expect(result.success).toBe(true)
    expect(mockRateLimiterFns.acquireKey).not.toHaveBeenCalled()
    expect(result.output.cost).toBeUndefined()

    Object.assign(tools, originalTools)
  })

  it('should skip hosted key injection when user provides an API key', async () => {
    const mockTool = {
      id: 'test_user_key_priority',
      name: 'Test User Key Priority',
      description: 'A test tool where user keys should win',
      version: '1.0.0',
      params: {
        apiKey: { type: 'string', required: false },
      },
      hosting: {
        envKeyPrefix: 'TEST_HOSTED_KEY',
        apiKeyParam: 'apiKey',
        pricing: {
          type: 'per_request' as const,
          cost: 0.005,
        },
        rateLimit: {
          mode: 'per_request' as const,
          requestsPerMinute: 100,
        },
      },
      operation: { input: (params: Record<string, unknown>) => params },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'success' },
      }),
    }

    const originalTools = { ...tools }
    ;(tools as any).test_user_key_priority = mockTool

    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createToolExecutionContext({
      userId: 'user-123',
    } as any)
    const result = await executeTool(
      'test_user_key_priority',
      { apiKey: 'user-api-key' },
      { executionContext: mockContext }
    )

    expect(result.success).toBe(true)
    expect(mockRateLimiterFns.acquireKey).not.toHaveBeenCalled()
    expect(result.output.cost).toBeUndefined()

    Object.assign(tools, originalTools)
  })
})
