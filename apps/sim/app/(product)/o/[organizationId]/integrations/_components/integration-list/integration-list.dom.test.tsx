/**
 * @vitest-environment jsdom
 *
 * The member Integrations index lists the member's own Search accounts beside the chosen
 * workspace's catalog, as the workspace's access policy judged it. Failure modes: the catalog left
 * out, so an organization with member accounts sees only its Search sources; an app the member
 * connects for Search and the workspace can also use listed twice; a workspace credential not
 * counting toward an app's connected state; and a restricted app offered as a page to open
 * instead of an access request.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import { IntegrationList } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-list/integration-list'
import type { AppSummary } from '@/platform/lib/integrations/center-model'
import type { OrganizationIntegration } from '@/platform/shared/integrations'

const Mark = () => null

function memberIntegration(
  id: string,
  accounts: OrganizationIntegration['accounts']
): OrganizationIntegration {
  return {
    id,
    providerId: id,
    icon: Mark,
    name: id,
    description: `${id} search`,
    category: 'Email',
    setupGuideUrl: 'https://docs.example',
    searchResource: null,
    searchReads: [],
    requestedScopes: null,
    accessDescription: '',
    availability: 'ready',
    status: 'Not connected',
    accounts,
  }
}

function workspaceApp(id: string, overrides: Partial<AppSummary> = {}): AppSummary {
  return {
    id,
    providerId: id,
    name: id,
    description: `${id} app`,
    category: 'Productivity',
    href: `/o/org/integrations/${id}?workspace=ws`,
    connected: false,
    credentialCount: 0,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  stubResizeObserver()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(apps: readonly AppSummary[], integrations: OrganizationIntegration[]) {
  act(() =>
    root.render(
      <NuqsTestingAdapter>
        <IntegrationList
          integrations={integrations}
          workspaceApps={apps}
          workspaceCredentials={[]}
          secrets={null}
          integrationHref={(id) => `/o/org/integrations/${id}`}
          secretsHref='/o/org/integrations/secrets'
          settled
        />
      </NuqsTestingAdapter>
    )
  )
}

function linksIn(group: string) {
  const section = container.querySelector(`section[aria-label="${group}"]`)
  return [...(section?.querySelectorAll('a[href]') ?? [])].map(
    (link) => new URL(link.getAttribute('href') ?? '', 'https://sim.test').pathname
  )
}

it('lists the workspace catalog beside the member’s Search accounts', () => {
  render([workspaceApp('notion')], [memberIntegration('gmail', [])])
  expect(linksIn('Available')).toEqual(['/o/org/integrations/gmail', '/o/org/integrations/notion'])
})

it('lists an app the member and the workspace share once, connected by either credential', () => {
  render(
    [workspaceApp('gmail', { connected: true, credentialCount: 1 })],
    [memberIntegration('gmail', [])]
  )
  expect(linksIn('Connected')).toEqual(['/o/org/integrations/gmail'])
  expect(linksIn('Available')).toEqual([])
})

it('opens an access request for a restricted app instead of its page', () => {
  render([workspaceApp('jira', { requestAccess: () => undefined })], [])
  expect(linksIn('Available')).toEqual([])
  expect(container.querySelector('section[aria-label="Available"] button')).not.toBeNull()
})
