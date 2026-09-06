/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskPill } from './task-pill'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
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
  await act(() => client.invalidateQueries({ queryKey: ['mothership-task', task.taskId] }))
  expect(await screen.findByText(/completed timer.*Timer elapsed/)).toBeTruthy()
})

it('never replaces a live terminal event with a cached pending status', async () => {
  const view = render(
    <QueryClientProvider client={client}>
      <TaskPill task={task} />
    </QueryClientProvider>
  )
  await waitFor(() => expect(client.getQueryData(['mothership-task', task.taskId])).toBeDefined())
  view.rerender(
    <QueryClientProvider client={client}>
      <TaskPill task={{ ...task, status: 'stopped' }} />
    </QueryClientProvider>
  )
  expect(screen.getByText(/stopped timer/)).toBeTruthy()
})
