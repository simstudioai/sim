/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import type { PausePointWithQueue } from '@/hooks/queries/resume-execution'

const mocks = vi.hoisted(() => ({
  pauseContextDetail: vi.fn(),
  refetch: vi.fn(),
  replace: vi.fn(),
  resumeContext: vi.fn(),
  resumeExecutionDetail: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))

vi.mock('@/hooks/queries/resume-execution', () => ({
  resumeKeys: {
    execution: (workflowId: string, executionId: string) => [
      'resume-execution',
      'execution',
      workflowId,
      executionId,
    ],
    context: (workflowId: string, executionId: string, contextId: string) => [
      'resume-execution',
      'context',
      workflowId,
      executionId,
      contextId,
    ],
  },
  usePauseContextDetail: mocks.pauseContextDetail,
  useResumeContext: mocks.resumeContext,
  useResumeExecutionDetail: mocks.resumeExecutionDetail,
}))

import ResumeExecutionPage, {
  selectInitialResumeContextId,
} from '@/app/(interfaces)/resume/[workflowId]/[executionId]/resume-page-client'

const params = { workflowId: 'workflow-1', executionId: 'execution-1' }

let container: HTMLDivElement
let queryClient: QueryClient
let root: Root

function apiError(status: number): ApiClientError {
  return new ApiClientError({
    status,
    message: status === 404 ? 'Workflow not found' : 'Request failed',
    body: { error: 'Request failed' },
  })
}

function renderPage(initialContextId?: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ResumeExecutionPage params={params} initialContextId={initialContextId} />
      </QueryClientProvider>
    )
  })
}

describe('ResumeExecutionPage', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.pauseContextDetail.mockReturnValue({ data: undefined, isLoading: false })
    mocks.resumeContext.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.resumeExecutionDetail.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isFetching: true,
      isLoading: true,
      refetch: mocks.refetch,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
  })

  it('renders a concealed state for an absent or newly inaccessible execution', () => {
    mocks.resumeExecutionDetail.mockReturnValue({
      data: undefined,
      error: apiError(404),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetch,
    })

    renderPage('context-1')

    expect(container.textContent).toContain('Execution Not Found')
    expect(container.textContent).not.toContain('Could Not Load Execution')
    expect(mocks.pauseContextDetail).toHaveBeenLastCalledWith(
      params.workflowId,
      params.executionId,
      undefined
    )
  })

  it('redirects an expired session back through login', () => {
    mocks.resumeExecutionDetail.mockReturnValue({
      data: undefined,
      error: apiError(401),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetch,
    })

    renderPage('context-1')

    const callbackPath = '/resume/workflow-1/execution-1?contextId=context-1'
    expect(mocks.replace).toHaveBeenCalledWith(
      `/login?callbackUrl=${encodeURIComponent(callbackPath)}`
    )
    expect(container.textContent).toContain('Redirecting to sign in')
  })

  it('shows a retryable error instead of mislabeling infrastructure failure', () => {
    mocks.resumeExecutionDetail.mockReturnValue({
      data: undefined,
      error: apiError(500),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetch,
    })

    renderPage()

    expect(container.textContent).toContain('Could Not Load Execution')
    expect(container.textContent).not.toContain('Execution Not Found')
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again'
    )
    expect(retryButton).toBeDefined()
    act(() => retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })
})

describe('selectInitialResumeContextId', () => {
  const pausePoints = [
    { contextId: 'resumed-context', resumeStatus: 'resumed' },
    { contextId: 'paused-context', resumeStatus: 'paused' },
  ] as PausePointWithQueue[]

  it('uses a requested context only when the authorized execution contains it', () => {
    expect(selectInitialResumeContextId(pausePoints, 'paused-context')).toBe('paused-context')
    expect(selectInitialResumeContextId(pausePoints, 'unknown-context')).toBe('paused-context')
  })

  it('falls back to the first context when none is paused', () => {
    expect(
      selectInitialResumeContextId(
        [{ contextId: 'first-context', resumeStatus: 'resumed' }] as PausePointWithQueue[],
        null
      )
    ).toBe('first-context')
  })
})
