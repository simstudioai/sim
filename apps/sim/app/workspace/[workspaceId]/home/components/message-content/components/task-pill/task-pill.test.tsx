/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mothershipTaskKeys } from '@/hooks/queries/mothership-tasks'
import { TaskPill } from './task-pill'

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
beforeEach(() => {
  request.mockReset().mockResolvedValue({ taskId: task.taskId, status: 'pending', summary: null })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
})

it('updates a pill in an earlier message without needing an event in that turn', async () => {
  render(
    <QueryClientProvider client={client}>
      <TaskPill task={task} />
    </QueryClientProvider>
  )
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  request.mockResolvedValue({ taskId: task.taskId, status: 'completed', summary: 'Timer elapsed' })
  await act(() => client.invalidateQueries({ queryKey: mothershipTaskKeys.detail(task.taskId) }))
  expect(await screen.findByText(/Background watch.*Completed timer/)).toBeTruthy()
  expect(screen.getByRole('status').title).toContain('Timer elapsed')
})

it('never replaces a live terminal event with a cached pending status', async () => {
  const view = render(
    <QueryClientProvider client={client}>
      <TaskPill task={task} />
    </QueryClientProvider>
  )
  await waitFor(() =>
    expect(client.getQueryData(mothershipTaskKeys.detail(task.taskId))).toBeDefined()
  )
  view.rerender(
    <QueryClientProvider client={client}>
      <TaskPill task={{ ...task, status: 'stopped' }} />
    </QueryClientProvider>
  )
  expect(screen.getByText(/Stopped timer/)).toBeTruthy()
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
  const status = screen.getByRole('status')
  expect(status.textContent).toBe('Background watch · Completed workflow run · Alfred')
  expect(status.title).toContain(summary)
  expect(status.textContent).not.toContain(executionId)
  expect(screen.queryByRole('button')).toBeNull()
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
    expect(screen.getByRole('status').textContent).not.toContain('Completed')
    expect(screen.getByRole('status').title).toContain('Run did not finish')
  }
)
