/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckInternalAuth,
  mockBuildOpenCodeSessionMemoryKey,
  mockBuildOpenCodeSessionTitle,
  mockCreateOpenCodeSession,
  mockGetStoredOpenCodeSession,
  mockLogOpenCodeFailure,
  mockPromptOpenCodeSession,
  mockResolveOpenCodeRepositoryOption,
  mockShouldRetryWithFreshOpenCodeSession,
  mockStoreOpenCodeSession,
} = vi.hoisted(() => ({
  mockCheckInternalAuth: vi.fn(),
  mockBuildOpenCodeSessionMemoryKey: vi.fn(),
  mockBuildOpenCodeSessionTitle: vi.fn(),
  mockCreateOpenCodeSession: vi.fn(),
  mockGetStoredOpenCodeSession: vi.fn(),
  mockLogOpenCodeFailure: vi.fn(),
  mockPromptOpenCodeSession: vi.fn(),
  mockResolveOpenCodeRepositoryOption: vi.fn(),
  mockShouldRetryWithFreshOpenCodeSession: vi.fn(),
  mockStoreOpenCodeSession: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { SESSION: 'session', API_KEY: 'api_key', INTERNAL_JWT: 'internal_jwt' },
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-request-id'),
}))

vi.mock('@/lib/opencode/service', () => ({
  buildOpenCodeSessionMemoryKey: mockBuildOpenCodeSessionMemoryKey,
  buildOpenCodeSessionTitle: mockBuildOpenCodeSessionTitle,
  createOpenCodeSession: mockCreateOpenCodeSession,
  getStoredOpenCodeSession: mockGetStoredOpenCodeSession,
  logOpenCodeFailure: mockLogOpenCodeFailure,
  promptOpenCodeSession: mockPromptOpenCodeSession,
  resolveOpenCodeRepositoryOption: mockResolveOpenCodeRepositoryOption,
  shouldRetryWithFreshOpenCodeSession: mockShouldRetryWithFreshOpenCodeSession,
  storeOpenCodeSession: mockStoreOpenCodeSession,
}))

import { POST } from '@/app/api/tools/opencode/prompt/route'

describe('POST /api/tools/opencode/prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'internal-user',
    })
    mockResolveOpenCodeRepositoryOption.mockResolvedValue({
      id: 'repo-a',
      label: 'repo-a',
      directory: '/app/repos/repo-a',
      projectId: 'project-1',
    })
    mockBuildOpenCodeSessionMemoryKey.mockReturnValue('memory-key')
    mockBuildOpenCodeSessionTitle.mockReturnValue('session-title')
    mockGetStoredOpenCodeSession.mockResolvedValue(null)
    mockCreateOpenCodeSession.mockResolvedValue({ id: 'session-1' })
    mockPromptOpenCodeSession.mockResolvedValue({
      content: 'OpenCode result',
      threadId: 'session-1',
      cost: 1.25,
    })
    mockStoreOpenCodeSession.mockResolvedValue(undefined)
    mockShouldRetryWithFreshOpenCodeSession.mockReturnValue(false)
    mockLogOpenCodeFailure.mockResolvedValue(undefined)
  })

  it('returns 401 when internal auth fails', async () => {
    mockCheckInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const request = createMockRequest('POST', {
      repository: 'repo-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      prompt: 'hello',
    })

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when workflow execution context is incomplete', async () => {
    const request = createMockRequest('POST', {
      repository: 'repo-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      prompt: 'hello',
      _context: {
        workspaceId: 'ws-1',
      },
    })

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({
      error: 'workspaceId and workflowId are required in execution context',
    })
  })

  it('creates a new OpenCode session when no stored session exists', async () => {
    const request = createMockRequest('POST', {
      repository: ' repo-a ',
      providerId: ' provider-a ',
      modelId: ' model-a ',
      systemPrompt: ' system prompt ',
      agent: ' planner ',
      prompt: ' explain the change ',
      _context: {
        workspaceId: 'ws-1',
        workflowId: 'wf-1',
        userId: 'user-123',
      },
    })

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockResolveOpenCodeRepositoryOption).toHaveBeenCalledWith('repo-a')
    expect(mockBuildOpenCodeSessionMemoryKey).toHaveBeenCalledWith('wf-1', 'user:user-123')
    expect(mockGetStoredOpenCodeSession).toHaveBeenCalledWith('ws-1', 'memory-key')
    expect(mockBuildOpenCodeSessionTitle).toHaveBeenCalledWith('repo-a', 'user:user-123')
    expect(mockCreateOpenCodeSession).toHaveBeenCalledWith('repo-a', 'session-title')
    expect(mockPromptOpenCodeSession).toHaveBeenCalledWith({
      repository: 'repo-a',
      sessionId: 'session-1',
      prompt: 'explain the change',
      systemPrompt: 'system prompt',
      providerId: 'provider-a',
      modelId: 'model-a',
      agent: 'planner',
    })
    expect(mockStoreOpenCodeSession).toHaveBeenCalledWith(
      'ws-1',
      'memory-key',
      expect.objectContaining({
        sessionId: 'session-1',
        repository: 'repo-a',
        updatedAt: expect.any(String),
      })
    )
    expect(data).toEqual({
      success: true,
      output: {
        content: 'OpenCode result',
        threadId: 'session-1',
        cost: 1.25,
      },
    })
  })

  it('reuses an existing stored session for the same repository', async () => {
    mockGetStoredOpenCodeSession.mockResolvedValue({
      sessionId: 'stored-session',
      repository: 'repo-a',
      updatedAt: '2026-03-25T00:00:00.000Z',
    })
    mockPromptOpenCodeSession.mockResolvedValue({
      content: 'Reused session result',
      threadId: 'stored-session',
    })

    const request = createMockRequest('POST', {
      repository: 'repo-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      prompt: 'continue',
      _context: {
        workspaceId: 'ws-1',
        workflowId: 'wf-1',
        executionId: 'exec-1',
      },
    })

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockBuildOpenCodeSessionMemoryKey).toHaveBeenCalledWith('wf-1', 'execution:exec-1')
    expect(mockCreateOpenCodeSession).not.toHaveBeenCalled()
    expect(mockPromptOpenCodeSession).toHaveBeenCalledWith({
      repository: 'repo-a',
      sessionId: 'stored-session',
      prompt: 'continue',
      systemPrompt: undefined,
      providerId: 'provider-a',
      modelId: 'model-a',
      agent: undefined,
    })
    expect(data).toEqual({
      success: true,
      output: {
        content: 'Reused session result',
        threadId: 'stored-session',
      },
    })
  })

  it('retries with a fresh session when the stored session is stale', async () => {
    mockGetStoredOpenCodeSession.mockResolvedValue({
      sessionId: 'stale-session',
      repository: 'repo-a',
      updatedAt: '2026-03-25T00:00:00.000Z',
    })
    mockPromptOpenCodeSession
      .mockRejectedValueOnce(new Error('session not found'))
      .mockResolvedValueOnce({
        content: 'Recovered result',
        threadId: 'fresh-session',
        cost: 2.5,
      })
    mockShouldRetryWithFreshOpenCodeSession.mockReturnValue(true)
    mockCreateOpenCodeSession.mockResolvedValue({ id: 'fresh-session' })

    const request = createMockRequest('POST', {
      repository: 'repo-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      prompt: 'retry please',
      _context: {
        workspaceId: 'ws-1',
        workflowId: 'wf-1',
        userId: 'user-123',
      },
    })

    const response = await POST(request as never)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockPromptOpenCodeSession).toHaveBeenCalledTimes(2)
    expect(mockShouldRetryWithFreshOpenCodeSession).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'session not found' })
    )
    expect(mockCreateOpenCodeSession).toHaveBeenCalledWith('repo-a', 'session-title')
    expect(mockStoreOpenCodeSession).toHaveBeenCalledWith(
      'ws-1',
      'memory-key',
      expect.objectContaining({
        sessionId: 'fresh-session',
        repository: 'repo-a',
      })
    )
    expect(mockLogOpenCodeFailure).not.toHaveBeenCalled()
    expect(data).toEqual({
      success: true,
      output: {
        content: 'Recovered result',
        threadId: 'fresh-session',
        cost: 2.5,
      },
    })
  })
})
