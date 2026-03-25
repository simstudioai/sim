/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateOpenCodeClient } = vi.hoisted(() => ({
  mockCreateOpenCodeClient: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {},
}))

vi.mock('@sim/db/schema', () => ({
  memory: {},
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/opencode/client', () => ({
  createOpenCodeClient: mockCreateOpenCodeClient,
}))

import {
  listOpenCodeRepositories,
  promptOpenCodeSession,
  shouldRetryWithFreshOpenCodeSession,
} from '@/lib/opencode/service'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('shouldRetryWithFreshOpenCodeSession', () => {
  it('returns true for stale-session errors', () => {
    expect(shouldRetryWithFreshOpenCodeSession(new Error('404 session not found'))).toBe(true)
    expect(shouldRetryWithFreshOpenCodeSession('session does not exist')).toBe(true)
    expect(shouldRetryWithFreshOpenCodeSession('unknown session')).toBe(true)
  })

  it('returns false for unrelated session errors', () => {
    expect(shouldRetryWithFreshOpenCodeSession(new Error('session limit exceeded'))).toBe(false)
    expect(shouldRetryWithFreshOpenCodeSession('invalid session format')).toBe(false)
    expect(shouldRetryWithFreshOpenCodeSession('model not found')).toBe(false)
    expect(shouldRetryWithFreshOpenCodeSession('provider does not exist')).toBe(false)
  })

  it('does not crash for undefined, symbol, or function errors', () => {
    expect(() => shouldRetryWithFreshOpenCodeSession(undefined)).not.toThrow()
    expect(() => shouldRetryWithFreshOpenCodeSession(Symbol('session'))).not.toThrow()
    expect(() => shouldRetryWithFreshOpenCodeSession(() => 'session')).not.toThrow()
    expect(shouldRetryWithFreshOpenCodeSession(undefined)).toBe(false)
  })
})

describe('listOpenCodeRepositories', () => {
  it('handles OPENCODE_REPOSITORY_ROOT set to / without double slashes', async () => {
    vi.stubEnv('OPENCODE_REPOSITORY_ROOT', '/')

    mockCreateOpenCodeClient.mockReturnValue({
      project: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: 'project-1', worktree: '/repo-a' }],
        }),
      },
    })

    await expect(listOpenCodeRepositories()).resolves.toEqual([
      {
        id: 'repo-a',
        label: 'repo-a',
        directory: '/repo-a',
        projectId: 'project-1',
      },
    ])
  })
})

describe('promptOpenCodeSession', () => {
  it('reuses the provided repository option without resolving repositories again', async () => {
    const mockSessionCreate = vi.fn().mockResolvedValue({
      data: { id: 'session-1' },
    })
    const mockSessionPrompt = vi.fn().mockResolvedValue({
      data: {
        info: {
          sessionID: 'session-1',
          cost: 0.75,
          providerID: 'provider-a',
          modelID: 'model-a',
        },
        parts: [{ type: 'text', text: 'OpenCode result' }],
      },
    })

    mockCreateOpenCodeClient.mockReturnValue({
      project: {
        list: vi.fn(),
      },
      session: {
        create: mockSessionCreate,
        prompt: mockSessionPrompt,
      },
    })

    const result = await promptOpenCodeSession({
      repository: 'repo-a',
      repositoryOption: {
        id: 'repo-a',
        label: 'repo-a',
        directory: '/app/repos/repo-a',
        projectId: 'project-1',
      },
      prompt: 'Explain the change',
      providerId: 'provider-a',
      modelId: 'model-a',
      title: 'session-title',
    })

    expect(mockSessionCreate).toHaveBeenCalledWith({
      query: { directory: '/app/repos/repo-a' },
      body: { title: 'session-title' },
      throwOnError: true,
    })
    expect(mockSessionPrompt).toHaveBeenCalledWith({
      path: { id: 'session-1' },
      query: { directory: '/app/repos/repo-a' },
      body: {
        parts: [{ type: 'text', text: 'Explain the change' }],
        model: {
          providerID: 'provider-a',
          modelID: 'model-a',
        },
      },
      throwOnError: true,
    })
    expect(result).toEqual({
      content: 'OpenCode result',
      threadId: 'session-1',
      cost: 0.75,
      providerId: 'provider-a',
      modelId: 'model-a',
      assistantError: undefined,
    })
  })
})
