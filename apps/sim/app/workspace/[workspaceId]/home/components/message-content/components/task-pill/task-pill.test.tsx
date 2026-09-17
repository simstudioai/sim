/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskPill } from '@/app/workspace/[workspaceId]/home/components/message-content/components/task-pill/task-pill'
import { mothershipTaskKeys } from '@/hooks/queries/mothership-tasks'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/mothership/tools/client/resource-display', () => ({
  resolveResourceDisplayName: (_type: string, id: unknown) =>
    id === 'workflow' ? 'Alfred' : undefined,
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: request }))
vi.mock('@sim/emcn', () => ({
  Check: () => null,
  Clock: () => null,
  X: () => null,
  cn: (...values: string[]) => values.join(' '),
}))
const task = {
  taskId: '22222222-2222-4222-8222-222222222222',
  kind: 'timer',
  target: {},
  note: 'follow up',
  status: 'pending',
} as const
let client: QueryClient
let container: HTMLDivElement
let root: Root

function render(content: ReactNode) {
  act(() => root.render(content))
  return { rerender: render }
}

function statusElement() {
  const status = container.querySelector<HTMLElement>('[role="status"]')
  expect(status).not.toBeNull()
  return status!
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  request.mockReset().mockResolvedValue({ taskId: task.taskId, status: 'pending', summary: null })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  client.clear()
})

it('updates a pill in an earlier message without needing an event in that turn', async () => {
  render(
    <QueryClientProvider client={client}>
      <TaskPill task={task} />
    </QueryClientProvider>
  )
  await act(async () => vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1)))
  request.mockResolvedValue({ taskId: task.taskId, status: 'completed', summary: 'Timer elapsed' })
  await act(() => client.invalidateQueries({ queryKey: mothershipTaskKeys.detail(task.taskId) }))
  await act(async () =>
    vi.waitFor(() => {
      expect(statusElement().textContent).toMatch(/Background watch.*Completed timer/)
    })
  )
  expect(statusElement().title).toContain('Timer elapsed')
})

it('never replaces a live terminal event with a cached pending status', async () => {
  const view = render(
    <QueryClientProvider client={client}>
      <TaskPill task={task} />
    </QueryClientProvider>
  )
  await act(async () =>
    vi.waitFor(() =>
      expect(client.getQueryData(mothershipTaskKeys.detail(task.taskId))).toBeDefined()
    )
  )
  view.rerender(
    <QueryClientProvider client={client}>
      <TaskPill task={{ ...task, status: 'stopped' }} />
    </QueryClientProvider>
  )
  expect(statusElement().textContent).toMatch(/Stopped timer/)
})

it('shows completed workflow watches as status without duplicate run ids or action controls', () => {
  const executionId = '733e3428-f081-4504-bc5e-25be3b515304'
  const summary = `Workflow run ${executionId} of "Alfred" completed`
  render(
    <QueryClientProvider client={client}>
      <TaskPill
        task={{
          ...task,
          kind: 'workflow_run',
          status: 'completed',
          target: { executionId, workflowId: 'workflow', workspaceId: 'workspace' },
          summary,
        }}
      />
    </QueryClientProvider>
  )
  const status = statusElement()
  expect(status.textContent).toBe('Background watch · Completed workflow run · Alfred')
  expect(status.title).toContain(summary)
  expect(status.textContent).not.toContain(executionId)
  expect(container.querySelector('button')).toBeNull()
  expect(request).not.toHaveBeenCalled()
})

it.each(['failed', 'expired', 'stopped'] as const)(
  'retains a %s workflow watch outcome and detail',
  (status) => {
    render(
      <QueryClientProvider client={client}>
        <TaskPill task={{ ...task, kind: 'workflow_run', status, summary: 'Run did not finish' }} />
      </QueryClientProvider>
    )
    expect(statusElement().textContent).not.toContain('Completed')
    expect(statusElement().title).toContain('Run did not finish')
  }
)
