/**
 * @vitest-environment jsdom
 *
 * An AWS or Databricks block runs only on a saved credential, so its credential picker must set one
 * up in place. Failure modes: the picker offers no "Add AWS credential" action, leaving the block
 * unconfigurable from the Platform; or the action opens nothing.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)

const WORKSPACE_ID = '3f0c7a52-1b6e-4d2a-9c8f-5e7d1a2b3c4d'
const idleQuery = { data: [], isFetching: false, isError: false, error: null, refetch: vi.fn() }

/** The block's stored value and workflow, which live in the workflow stores. */
vi.mock('@/platform/lib/data/workflow-editor', () => ({
  useDependsOnGate: () => ({ depsSatisfied: true, dependsOn: [], dependencyValues: {} }),
  useSubBlockValue: () => [null, vi.fn()],
  useWorkflowRegistry: (select: (state: { activeWorkflowId: string }) => unknown) =>
    select({ activeWorkflowId: 'workflow-1' }),
  useWorkflowScope: () => ({ workspaceId: WORKSPACE_ID }),
}))

vi.mock('@/platform/lib/data/workflow-editor/selectors', async (importActual) => ({
  ...(await importActual<typeof import('@/platform/lib/data/workflow-editor/selectors')>()),
  useOAuthCredentials: () => idleQuery,
  useWorkspaceCredentials: () => idleQuery,
  useWorkspaceCredential: () => ({ data: undefined }),
  useCredentialRefreshTriggers: () => {},
}))

import { CredentialSelector } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/credential-selector/credential-selector'
import type { SubBlockConfig } from '@/platform/lib/data/workflow-editor'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  stubResizeObserver()
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
  }
  Element.prototype.checkVisibility = () => true
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'https://sim.test')
      if (url.pathname === '/api/credentials/workload-identity')
        return Response.json({ available: false })
      return Response.json({ credentials: [] })
    })
  )
  container = document.createElement('div')
  // The product root marks where floating pickers portal to.
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function settle() {
  for (let round = 0; round < 6; round++) await act(flushMacrotask)
}

it.each([
  ['aws', 'Add AWS credential', 'Access key ID'],
  ['databricks', 'Add Databricks connection', 'Workspace host'],
])('opens the %s setup form from the picker', async (serviceId, action, firstField) => {
  const subBlock = {
    id: 'credential',
    type: 'oauth-input',
    title: 'Credential',
    serviceId,
    credentialKind: 'service-account',
  } as SubBlockConfig
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <CredentialSelector blockId='block-1' subBlock={subBlock} />
      </QueryClientProvider>
    )
  )
  await settle()

  const trigger = container.querySelector('[aria-label="Credential"]')
  if (!(trigger instanceof HTMLElement)) throw new Error('No credential picker')
  act(() => trigger.click())
  await settle()
  const create = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === action
  )
  if (!create) throw new Error(`The picker offers no ${action} action`)
  act(() => create.click())
  await settle()

  const dialog = document.body.querySelector('dialog[open]')
  expect(dialog?.textContent).toContain(action)
  expect(
    [...(dialog?.querySelectorAll('label') ?? [])].some(
      (label) => label.textContent?.trim() === firstField
    )
  ).toBe(true)
})
