/**
 * @vitest-environment jsdom
 *
 * An app whose saved credential is a pasted token (Fireflies, Apollo, Intercom…) connects from its
 * workspace page. Failure modes: the page filters the token method out, so the app cannot be
 * connected here; and the dialog submits something other than the descriptor's fields, so the
 * server's token verification never sees the key.
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

import { getTokenServiceAccountDescriptor } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  useWorkspaceAppCredentials,
  WorkspaceAppDialogs,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-app-credentials'
import type { WorkspaceAppDetail } from '@/platform/lib/integrations/workspace-catalog'

const WORKSPACE = { id: '3f0c7a52-1b6e-4d2a-9c8f-5e7d1a2b3c4d', name: 'Acme' }
const PROVIDER = 'fireflies-service-account'

/** Fireflies as the catalog projects it: its one method is the token service account. */
const FIREFLIES: WorkspaceAppDetail = {
  id: 'fireflies',
  type: 'fireflies_v3',
  slug: 'fireflies',
  name: 'Fireflies',
  description: 'Meeting transcripts',
  category: 'Productivity',
  docsUrl: 'https://docs.sim.test/fireflies',
  access: 'available',
  credentialProviders: [PROVIDER],
  connections: [
    {
      id: PROVIDER,
      kind: 'service_account',
      label: 'Add API key',
      providerId: PROVIDER,
      setup: 'fields',
    },
  ],
  instanceLabels: {},
  example: '',
  skills: [],
  templates: [],
}

let container: HTMLDivElement
let root: Root
let created: unknown[]
let page: ReturnType<typeof useWorkspaceAppCredentials> | undefined

beforeEach(() => {
  stubResizeObserver()
  // jsdom has no modal dialog API; the product dialog is a native <dialog>.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
  }
  Element.prototype.checkVisibility = () => true
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  created = []
  page = undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'https://sim.test')
      if (url.pathname === '/api/credentials' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        created.push(body)
        return Response.json({
          credential: {
            id: 'cred-new',
            workspaceId: WORKSPACE.id,
            type: 'service_account',
            displayName: 'Fireflies',
            description: null,
            unredacted: false,
            providerId: PROVIDER,
            accountId: null,
            envKey: null,
            envOwnerUserId: null,
            createdBy: 'viewer',
            createdAt: '2026-11-10T00:00:00.000Z',
            updatedAt: '2026-11-10T00:00:00.000Z',
          },
        })
      }
      return Response.json({ credentials: [] })
    })
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function settle() {
  for (let round = 0; round < 5; round++) await act(flushMacrotask)
}

function WorkspacePage() {
  page = useWorkspaceAppCredentials({ app: FIREFLIES, workspace: WORKSPACE, credentials: [] }, null)
  return <WorkspaceAppDialogs app={FIREFLIES} workspaceId={WORKSPACE.id} dialogs={page.dialogs} />
}

function fieldIn(dialog: Element, label: string) {
  const labelled = [...dialog.querySelectorAll('label')].find(
    (item) => item.textContent?.trim() === label
  )
  const control = labelled?.htmlFor
    ? dialog.querySelector(`#${CSS.escape(labelled.htmlFor)}`)
    : labelled?.querySelector('input')
  if (!(control instanceof HTMLInputElement)) throw new Error(`No ${label} field`)
  return control
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it("offers a token app's connect method and submits the descriptor's fields", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <WorkspacePage />
      </QueryClientProvider>
    )
  )
  await settle()

  const method = page?.methods.find((entry) => entry.id === PROVIDER)
  expect(method).toBeDefined()
  act(() => method?.onSelect())
  await settle()

  const dialog = document.body.querySelector('dialog[open]')
  if (!dialog) throw new Error('The connect dialog did not open')
  const descriptor = getTokenServiceAccountDescriptor(PROVIDER)
  for (const field of descriptor?.fields ?? []) type(fieldIn(dialog, field.label), ' ff-secret ')
  const confirm = [...dialog.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Add API key'
  )
  if (!confirm) throw new Error('The dialog offers no way to add the key')
  act(() => confirm.click())
  await settle()

  expect(created).toEqual([
    {
      workspaceId: WORKSPACE.id,
      type: 'service_account',
      providerId: PROVIDER,
      apiToken: 'ff-secret',
    },
  ])
})
