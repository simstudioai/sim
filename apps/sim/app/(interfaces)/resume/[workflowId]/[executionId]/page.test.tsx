/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getSession: vi.fn(),
  resumePage: vi.fn(() => null),
  unavailablePage: vi.fn(() => null),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mocks.getSession,
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('@/lib/workflows/application/read-paused-workflow-execution', () => ({
  readPausedWorkflowExecution: { authorize: mocks.authorize },
}))

vi.mock('@/app/(interfaces)/resume/[workflowId]/[executionId]/resume-page-client', () => ({
  default: mocks.resumePage,
}))

vi.mock(
  '@/app/(interfaces)/resume/[workflowId]/[executionId]/resume-execution-unavailable',
  () => ({
    ResumeExecutionUnavailable: mocks.unavailablePage,
  })
)

import ResumeExecutionPageWrapper from '@/app/(interfaces)/resume/[workflowId]/[executionId]/page'

const PAGE_PARAMS = { workflowId: 'workflow-1', executionId: 'execution-1' }

function pageProps(contextId?: string) {
  return {
    params: Promise.resolve(PAGE_PARAMS),
    searchParams: Promise.resolve(contextId ? { contextId } : {}),
  }
}

describe('ResumeExecutionPageWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.authorize.mockResolvedValue(undefined)
  })

  it('redirects an unauthenticated visitor before any protected lookup', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const callbackPath = '/resume/workflow-1/execution-1?contextId=context-1'

    await expect(ResumeExecutionPageWrapper(pageProps('context-1'))).rejects.toThrow(
      `NEXT_REDIRECT:/login?callbackUrl=${encodeURIComponent(callbackPath)}`
    )
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('authorizes the session without serializing paused execution detail into the page', async () => {
    const result = await ResumeExecutionPageWrapper(pageProps('context-1'))

    expect(mocks.authorize).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: PAGE_PARAMS,
    })
    expect(result.props).toMatchObject({
      params: PAGE_PARAMS,
      initialContextId: 'context-1',
    })
    expect(result.type).toBe(mocks.resumePage)
    expect(result.key).toBe('workflow-1:execution-1:context-1')
    expect(result.props).not.toHaveProperty('initialExecutionDetail')
    expect(result.props).not.toHaveProperty('canLoadExecution')
  })

  it.each([
    new OrchestrationError('forbidden', 'Insufficient workspace permissions'),
    new OrchestrationError('not_found', 'Workflow not found'),
  ])('renders a data-free concealed state after authorization refusal: %s', async (error) => {
    mocks.authorize.mockRejectedValueOnce(error)

    const result = await ResumeExecutionPageWrapper(pageProps())

    expect(result.type).toBe(mocks.unavailablePage)
    expect(result.type).not.toBe(mocks.resumePage)
    expect(result.props).toEqual({})
  })

  it('propagates authorization infrastructure failures', async () => {
    const infrastructureError = new Error('database unavailable')
    mocks.authorize.mockRejectedValueOnce(infrastructureError)

    await expect(ResumeExecutionPageWrapper(pageProps())).rejects.toBe(infrastructureError)
  })
})
