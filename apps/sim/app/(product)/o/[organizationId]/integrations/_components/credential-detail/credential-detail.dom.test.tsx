/**
 * @vitest-environment jsdom
 *
 * A credential's Details form. Failure modes: leaving with an unsaved rename dropping it without the
 * shared discard prompt; a rename made elsewhere (another tab) never reaching an untouched form, so
 * its next save writes the old name back; that same rename overwriting a draft the reader is
 * typing; and the sites an Atlassian grant reaches staying invisible.
 */
import { act } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)

import { CredentialDetail } from '@/app/(product)/o/[organizationId]/integrations/_components/credential-detail/credential-detail'
import { requestSettingsLeave, useSettingsDirtyStore } from '@/platform/lib/data/settings-guard'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

const VIEWER = { id: 'viewer', name: 'Viewer', email: 'viewer@sim.test' }

function credential(overrides: Partial<IntegrationCredential> = {}): IntegrationCredential {
  return {
    id: 'cred-1',
    appId: 'jira',
    providerId: 'jira',
    type: 'oauth',
    displayName: 'Support inbox',
    description: '',
    role: 'admin',
    status: 'active',
    canReconnect: false,
    scope: { kind: 'personal', ownerId: VIEWER.id },
    members: [],
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
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
  useSettingsDirtyStore.getState().reset()
})

function render(current: IntegrationCredential, sites?: readonly { name: string; url: string }[]) {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>
          <CredentialDetail
            credential={current}
            integrationName='Jira'
            viewer={VIEWER}
            sites={sites}
            onSaveDetails={async () => undefined}
            onDisconnect={() => undefined}
          />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
}

function nameField() {
  const label = [...container.querySelectorAll('label')].find(
    (candidate) => candidate.textContent?.trim() === 'Display name'
  )
  const id = label?.getAttribute('for')
  return (id ? document.getElementById(id) : null) as HTMLInputElement | null
}

function type(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('holds a leave while a rename is unsaved', () => {
  render(credential())
  type(nameField(), 'Renamed inbox')
  const leave = vi.fn()
  act(() => requestSettingsLeave(leave))
  expect(leave).not.toHaveBeenCalled()
})

it('lets a leave through once the form is clean', () => {
  render(credential())
  const leave = vi.fn()
  act(() => requestSettingsLeave(leave))
  expect(leave).toHaveBeenCalledTimes(1)
})

it('takes a rename made elsewhere into an untouched form', () => {
  render(credential())
  render(credential({ displayName: 'Renamed in another tab' }))
  expect(nameField()?.value).toBe('Renamed in another tab')
})

it('keeps the reader’s draft when a rename arrives from elsewhere', () => {
  render(credential())
  type(nameField(), 'My draft')
  render(credential({ displayName: 'Renamed in another tab' }))
  expect(nameField()?.value).toBe('My draft')
})

it('lists the sites the account reaches', () => {
  render(credential(), [
    { name: 'Acme', url: 'https://acme.atlassian.net' },
    { name: 'Beta', url: 'https://beta.atlassian.net' },
  ])
  expect(container.textContent).toContain('Sites')
  const values = [...container.querySelectorAll('textarea, input')].map(
    (field) => (field as HTMLTextAreaElement).value
  )
  expect(values.join('\n')).toContain('Acme (acme.atlassian.net)')
  expect(values.join('\n')).toContain('Beta (beta.atlassian.net)')
})

it('shows no Sites field for an account with none', () => {
  render(credential(), [])
  expect(container.textContent).not.toContain('Sites')
})
