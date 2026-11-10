/**
 * @vitest-environment jsdom
 *
 * A secret's usage trail links each run to its log and names its trigger as Logs does. Failure
 * modes: View log going through the redirecting `?executionId=` URL instead of the run's own page,
 * and a trigger reading one way here and another in the Logs filter.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/platform/lib/data/secrets', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSecretUsage: () => ({
    isPending: false,
    isError: false,
    data: {
      entries: [
        {
          id: 'use-1',
          useCount: 1,
          lastUsedAt: '2026-11-01T10:00:00.000Z',
          source: 'workflow',
          workflowName: 'Nightly',
          actorName: 'Ada',
          lastExecutionId: 'exec-1',
          lastExecutionAvailable: true,
          lastTrigger: 'mothership',
        },
      ],
    },
  }),
}))

import { SecretUsage } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-usage'
import { RUN_TRIGGER_OPTIONS } from '@/platform/lib/data/logs'

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

it('links a run straight to its log and names its trigger as the Logs filter does', () => {
  act(() => root.render(<SecretUsage workspaceId='ws' secretName='API_KEY' scope='workspace' />))
  const link = [...container.querySelectorAll('a')].find((a) => a.textContent === 'View log')
  expect(link?.getAttribute('href')).toBe('/workspace/ws/logs/exec-1')
  const logsLabel = RUN_TRIGGER_OPTIONS.find((option) => option.value === 'mothership')?.label
  expect(logsLabel).toBeDefined()
  const cells = [...container.querySelectorAll('*')].map((element) => element.textContent)
  expect(cells).toContain(logsLabel)
})
