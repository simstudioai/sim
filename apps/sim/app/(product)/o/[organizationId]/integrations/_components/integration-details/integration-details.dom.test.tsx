/**
 * @vitest-environment jsdom
 *
 * A workspace credential opens on the example design's credential page, and an app's page offers
 * only the ways to connect that exist. Failure modes: a rename the server refuses clears the draft
 * the user typed; an app the catalog lists no connection for showing a disabled Connect that can
 * never work; an app this deployment has not configured, or whose listed connections it cannot
 * complete, losing the disabled Connect that says why; and a member integration the organization
 * disables saying so in place of the credential list while the workspace's Connect menu works.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)

import type { ComponentProps } from 'react'
import { IntegrationDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-details/integration-details'
import type { WorkspaceCredential } from '@/platform/lib/data/credentials'
import type { WorkspaceAppDetail } from '@/platform/lib/integrations/workspace-catalog'
import { SurfaceScopeProvider } from '@/platform/lib/surface-scope'
import type { OrganizationIntegration } from '@/platform/shared/integrations'

const WORKSPACE = { id: 'ws-1', name: 'Acme' }
const VIEWER = { id: 'viewer', name: 'Viewer', email: 'viewer@sim.test', image: null }

const GMAIL: WorkspaceAppDetail = {
  id: 'gmail',
  type: 'gmail_v2',
  slug: 'gmail',
  name: 'Gmail',
  description: 'Send and read Gmail messages',
  category: 'Email',
  docsUrl: 'https://docs.sim.test/gmail',
  access: 'available',
  credentialProviders: ['google-email'],
  connections: [
    {
      id: 'google-email',
      kind: 'oauth',
      label: 'Connect with OAuth',
      providerId: 'google-email',
      setup: 'oauth',
    },
  ],
  instanceLabels: {},
  example: '',
  skills: [],
  templates: [],
}

function credential(overrides: Partial<WorkspaceCredential> = {}): WorkspaceCredential {
  return {
    id: 'cred-1',
    workspaceId: WORKSPACE.id,
    type: 'oauth',
    displayName: 'Support inbox',
    description: null,
    unredacted: false,
    providerId: 'google-email',
    accountId: null,
    envKey: null,
    envOwnerUserId: null,
    createdBy: VIEWER.id,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    role: 'admin',
    status: 'active',
    ...overrides,
  }
}

function respond(url: URL, method: string, body: unknown) {
  if (url.pathname === '/api/credentials/cred-1/members')
    return Response.json({
      members: [
        {
          id: 'grant-1',
          userId: VIEWER.id,
          role: 'admin',
          status: 'active',
          joinedAt: null,
          userName: VIEWER.name,
          userEmail: VIEWER.email,
          roleSource: 'explicit',
          explicitAdmin: true,
        },
      ],
    })
  if (url.pathname === `/api/workspaces/${WORKSPACE.id}/permissions`)
    return Response.json({ users: [], total: 0 })
  if (url.pathname === '/api/credentials/cred-1' && method === 'PUT')
    return (body as { displayName?: string }).displayName === 'Taken inbox'
      ? Response.json(
          { error: 'A credential with this display name already exists' },
          { status: 409 }
        )
      : Response.json({ credential: { ...credential(), ...(body as object) } })
  return Response.json({ error: 'Not found' }, { status: 404 })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  stubResizeObserver()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'https://sim.test')
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      return respond(url, method, body)
    })
  )
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: VIEWER },
    isPending: false,
    error: null,
  })
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

async function open(credentials: WorkspaceCredential[]) {
  await show({
    workspaceApp: { app: GMAIL, workspace: WORKSPACE, credentials },
    accountId: 'cred-1',
  })
}

async function show({
  integration,
  workspaceApp,
  accountId = null,
}: Pick<ComponentProps<typeof IntegrationDetails>, 'integration' | 'workspaceApp'> & {
  accountId?: string | null
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter>
          <SurfaceScopeProvider routePrefix='/o/org'>
            <IntegrationDetails
              integration={integration}
              workspaceApp={workspaceApp}
              accountId={accountId}
              integrationHref='/o/org/integrations/gmail'
              accountHref={(account) => `/o/org/integrations/gmail?account=${account}`}
              pending={false}
              onConnect={() => undefined}
              onReconnect={() => undefined}
              onDisconnect={async () => undefined}
              onLeave={() => undefined}
              renderToolPermissions={() => null}
            />
          </SurfaceScopeProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
  await settle()
}

function field(form: Element, label: string) {
  const labelled = [...form.querySelectorAll('label')].find((item) => item.textContent === label)
  const control = labelled?.htmlFor ? form.querySelector(`#${CSS.escape(labelled.htmlFor)}`) : null
  if (!(control instanceof HTMLInputElement)) throw new Error(`No ${label} field`)
  return control
}

function rename(displayName: string) {
  const form = container.querySelector('form[aria-label="Credential details"]')
  if (!form) throw new Error('The credential page did not open')
  const name = field(form, 'Display name')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      name,
      displayName
    )
    name.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const submit = form.querySelector('button[type="submit"]')
  if (!(submit instanceof HTMLButtonElement)) throw new Error('Save is not offered')
  act(() => submit.click())
  return name
}

it('keeps a refused rename’s draft for the user to correct', async () => {
  await open([credential()])
  const name = rename('Taken inbox')
  await settle()

  expect(name.value).toBe('Taken inbox')
})

/** The page's Connect when no method can connect: a disabled button explaining why. */
function disabledConnect() {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Connect integration'
  )
}

function workspaceOnly(app: WorkspaceAppDetail) {
  return { workspaceApp: { app, workspace: WORKSPACE, credentials: [] } }
}

it('offers no Connect for an app the catalog lists no connection for', async () => {
  await show(workspaceOnly({ ...GMAIL, credentialProviders: [], connections: [] }))
  expect(disabledConnect()).toBeUndefined()
})

it('keeps the disabled Connect for an app this deployment has not configured', async () => {
  await show(workspaceOnly({ ...GMAIL, access: 'unconfigured', connections: [] }))
  expect(disabledConnect()?.disabled).toBe(true)
})

it('keeps the disabled Connect for an app whose listed connections cannot complete here', async () => {
  await show(workspaceOnly({ ...GMAIL, connections: [] }))
  expect(disabledConnect()?.disabled).toBe(true)
})

it('lists credentials, not the organization’s refusal, while the workspace can still connect', async () => {
  const blocked: OrganizationIntegration = {
    id: 'gmail',
    providerId: 'google-email',
    icon: () => null,
    name: 'Gmail',
    description: 'Gmail search',
    category: 'Email',
    setupGuideUrl: 'https://docs.sim.test/gmail',
    searchResource: null,
    searchReads: [],
    requestedScopes: null,
    accessDescription: '',
    availability: 'blocked',
    status: 'Disabled by your organization',
    accounts: [],
  }
  await show({ integration: blocked, workspaceApp: workspaceOnly(GMAIL).workspaceApp })
  expect(container.querySelector('section[aria-label="Connected credentials"]')).not.toBeNull()
})
