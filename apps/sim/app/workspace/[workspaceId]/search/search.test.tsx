/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('nuqs', () => ({
  useQueryState: () => ['', vi.fn()],
}))
vi.mock('@/hooks/use-debounced-search-setter', () => ({
  useDebouncedSearchSetter: (write: (value: string) => void) => write,
}))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([
      ['confluence', { state: 'ready', oauthAvailable: true }],
      /* A service-account-only deployment: the block is usable, the OAuth path is not. */
      ['slack', { state: 'limited', oauthAvailable: false }],
    ]),
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration', () => ({
  useScrollRestoration: () => {},
}))
vi.mock('@/hooks/use-oauth-return', () => ({
  useOAuthReturnRouter: () => {},
}))
vi.mock('@/app/workspace/[workspaceId]/components', () => ({
  IntegrationTabsHeader: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: ({ open, providerId }: { open: boolean; providerId: string }) =>
    open ? <div data-testid='connect-modal'>{providerId}</div> : null,
}))
vi.mock('@/blocks', () => ({ getBlock: () => undefined }))
vi.mock('@/lib/integrations', () => ({
  resolveCredentialDisplay: () => ({ icon: () => null, blockType: 'confluence', subtitle: 'Sub' }),
}))

vi.mock('@/lib/sim-search/connectors', () => {
  const icon = () => null
  const connector = (type: string, name: string, description: string) => ({
    type,
    meta: { id: type, name, description, icon },
    providerId: type,
    providerIds: [type],
    requiredScopes: [],
    serviceName: name,
    serviceIcon: icon,
    blockType: type,
  })
  const providers = new Set(['confluence', 'jira', 'slack'])
  return {
    isSearchConnectorAvailable: (
      candidate: { blockType: string },
      availability: ReadonlyMap<string, { oauthAvailable: boolean }>
    ) => availability.get(candidate.blockType)?.oauthAvailable ?? true,
    SEARCH_CONNECTORS: [
      connector('confluence', 'Confluence', 'Sync Confluence pages'),
      connector('jira', 'Jira', 'Sync Jira issues'),
      connector('slack', 'Slack', 'Sync Slack messages'),
    ],
    isSearchConnectorProvider: (providerId: string | null) =>
      providerId !== null && providers.has(providerId),
  }
})

const credential = (overrides: Record<string, unknown>) => ({
  id: 'cred',
  workspaceId: 'workspace-1',
  type: 'oauth',
  displayName: 'Credential',
  description: null,
  unredacted: false,
  providerId: 'confluence',
  accountId: null,
  envKey: null,
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: '',
  updatedAt: '',
  role: 'admin',
  ...overrides,
})

vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredentials: () => ({
    isPending: false,
    data: [
      credential({ id: 'cred-mine', displayName: 'My Confluence' }),
      credential({
        id: 'cred-theirs',
        displayName: 'Teammate Jira',
        providerId: 'jira',
        createdBy: 'user-2',
      }),
      credential({ id: 'cred-sa', displayName: 'Service Account', type: 'service_account' }),
      credential({ id: 'cred-github', displayName: 'My GitHub', providerId: 'github' }),
    ],
  }),
}))

import { Search } from '@/app/workspace/[workspaceId]/search/search'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Search />))
}

function sectionLabels(): string[] {
  return Array.from(container?.querySelectorAll('section > div > span') ?? []).map(
    (node) => node.textContent ?? ''
  )
}

function hrefs(): Array<string | null> {
  return Array.from(container?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href'))
}

function connectButton(name: string): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>(`button[aria-label="Connect ${name}"]`) ?? null
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('Search', () => {
  it('lists the viewer’s own search-connector credentials under Connected', () => {
    mount()

    expect(sectionLabels()).toEqual(['Connected', 'Sim Search Connectors'])
    const text = container?.textContent ?? ''
    expect(text).toContain('My Confluence')
    expect(text).not.toContain('Teammate Jira')
    expect(text).not.toContain('Service Account')
    expect(text).not.toContain('My GitHub')
    expect(hrefs()).toContain('/workspace/workspace-1/search/connected/cred-mine')
  })

  it('opens the connect modal for a connector instead of navigating', () => {
    mount()

    const connect = connectButton('Confluence')
    expect(connect).not.toBeNull()
    expect(hrefs()).not.toContain('/workspace/workspace-1/search/confluence')
    expect(document.querySelector('[data-testid="connect-modal"]')).toBeNull()

    act(() => {
      connect?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })

    expect(document.querySelector('[data-testid="connect-modal"]')?.textContent).toBe('confluence')
  })

  it('disables a connector whose OAuth path is unavailable, even when the block is usable', () => {
    mount()

    expect(connectButton('Jira')).not.toBeNull()
    expect(connectButton('Slack')).toBeNull()
    expect(container?.textContent).toContain(
      'Unavailable in this deployment. Contact your administrator.'
    )
  })
})
