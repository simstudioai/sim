/**
 * @vitest-environment jsdom
 *
 * Forking copies the workspace's resources, which the dialog reads first. Failure mode: a failed
 * resource read leaving the dialog with Fork disabled and no word of why or how to retry.
 */
import { act } from 'react'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
const forks = vi.hoisted(() => ({ refetch: vi.fn() }))
vi.mock('@/platform/lib/data/forks', () => ({
  useForkWorkspace: () => ({ mutateAsync: vi.fn() }),
  useForkResources: () => ({
    data: undefined,
    isError: true,
    isFetching: false,
    error: new Error('Network down'),
    refetch: forks.refetch,
  }),
}))

import { ForkWorkspaceModal } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-workspace-modal'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  // The dialog focuses its first visible field, which jsdom cannot measure.
  Object.assign(Element.prototype, { checkVisibility: () => true })
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('shows a failed resource read with Retry inside the dialog', async () => {
  act(() =>
    root.render(
      <ForkWorkspaceModal
        sourceWorkspaceId='ws'
        sourceWorkspaceName='Workspace'
        canFork
        onUpgrade={() => undefined}
        onClose={() => undefined}
      />
    )
  )
  const retry = [...document.querySelectorAll('dialog[open] button')].find(
    (button) => button.textContent === 'Retry'
  )
  await act(async () => (retry as HTMLButtonElement | undefined)?.click())
  expect(forks.refetch).toHaveBeenCalled()
})
