/**
 * @vitest-environment jsdom
 *
 * A schedule trigger's status is a read. Failure mode: a failed read painting nothing, so a broken
 * schedule looks the same as one still loading.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const schedule = vi.hoisted(() => ({ refetch: vi.fn() }))
vi.mock('@/platform/lib/data/workflow-editor', () => ({
  useSubBlockStore: () => undefined,
  useWorkflowScope: () => ({ workflowId: 'wf' }),
}))
vi.mock('@/platform/lib/data/workflow-editor/uploads', () => ({
  MAX_CONSECUTIVE_FAILURES: 10,
  parseCronToHumanReadable: () => '',
  useRedeployWorkflowSchedule: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useScheduleQuery: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    isFetching: false,
    error: new Error('Network down'),
    refetch: schedule.refetch,
  }),
}))

import { ScheduleInfo } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/schedule-info/schedule-info'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('shows a failed schedule read with Retry', async () => {
  act(() => root.render(<ScheduleInfo blockId='block' />))
  const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')
  await act(async () => retry?.click())
  expect(schedule.refetch).toHaveBeenCalled()
})
