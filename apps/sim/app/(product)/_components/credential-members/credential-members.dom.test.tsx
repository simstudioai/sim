/**
 * @vitest-environment jsdom
 *
 * A credential's Members section over its roster read. Failure modes: a count claimed before the
 * roster answers ("Members (0)" while it loads), and a failed read painted as an empty roster with
 * no way to retry.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/client', () => authClientMock)

import { CredentialMembers } from '@/app/(product)/_components/credential-members/credential-members'

const ADA = {
  id: 'member-ada',
  userId: 'ada',
  role: 'admin',
  status: 'active',
  joinedAt: '2026-01-01T00:00:00.000Z',
  userName: 'Ada',
  userEmail: 'ada@sim.test',
  roleSource: 'explicit',
  explicitAdmin: true,
}

let membersReply: () => Promise<Response>
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  membersReply = async () => Response.json({ members: [ADA] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'https://sim.test')
      if (url.pathname === '/api/credentials/cred-1/members') return membersReply()
      return Response.json({ error: 'Not found' }, { status: 404 })
    })
  )
  authClientMockFns.mockUseSession.mockReturnValue({
    data: { user: { id: 'viewer', name: 'Viewer', email: 'viewer@sim.test', image: null } },
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
  for (let round = 0; round < 6; round++) await act(flushMacrotask)
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <CredentialMembers
          credentialId='cred-1'
          credentialName='Support inbox'
          isAdmin
          onLeft={() => undefined}
        />
      </QueryClientProvider>
    )
  )
}

function retryButton() {
  return [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry')
}

it('claims no member count while the roster loads', async () => {
  let release = () => {}
  membersReply = () =>
    new Promise((resolve) => {
      release = () => resolve(Response.json({ members: [ADA] }))
    })
  render()
  await settle()
  expect(container.textContent).toContain('Members')
  expect(container.textContent).not.toMatch(/Members \(\d+\)/)

  release()
  await settle()
  expect(container.textContent).toContain('Members (1)')
})

it('shows a failed roster read with Retry instead of an empty roster', async () => {
  membersReply = async () => Response.json({ error: 'boom' }, { status: 500 })
  render()
  await settle()
  expect(container.textContent).not.toContain('Members (0)')
  expect(retryButton()).toBeDefined()

  membersReply = async () => Response.json({ members: [ADA] })
  await act(async () => retryButton()?.click())
  await settle()
  expect(container.textContent).toContain('Members (1)')
  expect(container.textContent).toContain('Ada')
})
