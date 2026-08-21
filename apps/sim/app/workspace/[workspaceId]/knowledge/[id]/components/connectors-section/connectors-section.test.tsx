/**
 * @vitest-environment jsdom
 */
import type { ReactNode, SVGProps } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncLogData } from '@/lib/api/contracts/knowledge/connectors'
import { CONNECTOR_SYNC_STALE_LOCK_TTL_MS } from '@/lib/knowledge/connectors/sync-limits'

const { icon } = vi.hoisted(() => ({
  icon: (name: string) => (props: SVGProps<SVGSVGElement>) => (
    <svg data-testid={`icon-${name}`} className={props.className} />
  ),
}))

vi.mock('@sim/emcn/icons', () => ({
  ChevronDown: icon('chevron-down'),
  CircleAlert: icon('circle-alert'),
  CircleCheck: icon('circle-check'),
  CircleX: icon('circle-x'),
  Loader: icon('loader'),
  Pause: icon('pause'),
  Play: icon('play'),
  RefreshCw: icon('refresh-cw'),
  Settings: icon('settings'),
  Trash: icon('trash'),
  TriangleAlert: icon('triangle-alert'),
}))

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children }: { children?: ReactNode }) => <button type='button'>{children}</button>,
  Checkbox: () => <input type='checkbox' />,
  ChipConfirmModal: () => null,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/credentials/client-state', () => ({
  consumeOAuthReturnContext: vi.fn(),
  writeOAuthReturnContext: vi.fn(),
}))
vi.mock('@/lib/oauth', () => ({
  getCanonicalScopesForProvider: vi.fn(() => []),
  getProviderIdFromServiceId: vi.fn(() => undefined),
}))
vi.mock('@/lib/oauth/utils', () => ({ getMissingRequiredScopes: vi.fn(() => []) }))
vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/edit-connector-modal',
  () => ({ EditConnectorModal: () => null })
)
vi.mock('@/blocks', () => ({ getBlock: vi.fn(() => undefined) }))
vi.mock('@/blocks/icon-color', () => ({ getTileIconColorClass: vi.fn(() => '') }))
vi.mock('@/connectors/registry', () => ({ CONNECTOR_META_REGISTRY: {} }))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useConnectorDetail: vi.fn(() => ({ data: undefined, isLoading: false })),
  useDeleteConnector: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateConnector: vi.fn(() => ({ mutate: vi.fn() })),
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: vi.fn(() => ({ data: [] })),
}))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: vi.fn(),
}))

import { SyncHistory } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connectors-section'

let root: Root | null = null

function makeLog(overrides: Partial<SyncLogData> & Pick<SyncLogData, 'status'>): SyncLogData {
  return {
    id: 'log-1',
    connectorId: 'connector-1',
    startedAt: new Date().toISOString(),
    completedAt: null,
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsFailed: 0,
    errorMessage: null,
    ...overrides,
  }
}

function render(log: SyncLogData) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SyncHistory logs={[log]} isLoading={false} />))
  return container
}

function icons(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid^="icon-"]')).map((node) =>
    node.getAttribute('data-testid')
  )
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('SyncHistory', () => {
  it('renders a fresh "started" row as in progress, not as a success', () => {
    const container = render(makeLog({ status: 'started' }))

    expect(icons(container)).toEqual(['icon-loader'])
    expect(icons(container)).not.toContain('icon-circle-check')
    expect(container.textContent).toContain('In progress…')
    expect(container.textContent).not.toContain('No changes')
  })

  it('renders a "completed" row as a success with its change counts', () => {
    const container = render(makeLog({ status: 'completed', docsAdded: 3 }))

    expect(icons(container)).toEqual(['icon-circle-check'])
    expect(container.textContent).toContain('+3')
    expect(container.textContent).not.toContain('In progress…')
  })

  it('renders a "completed" row with no changes as "No changes"', () => {
    const container = render(makeLog({ status: 'completed' }))

    expect(icons(container)).toEqual(['icon-circle-check'])
    expect(container.textContent).toContain('No changes')
  })

  it('renders a "failed" row as an error with its message', () => {
    const container = render(makeLog({ status: 'failed', errorMessage: 'token expired' }))

    expect(icons(container)).toEqual(['icon-circle-x'])
    expect(container.textContent).toContain('token expired')
    expect(container.textContent).not.toContain('No changes')
  })

  describe('stale-lock boundary', () => {
    it('still reads as in progress just inside the stale-lock TTL', () => {
      const startedAt = new Date(
        Date.now() - CONNECTOR_SYNC_STALE_LOCK_TTL_MS + 60_000
      ).toISOString()
      const container = render(makeLog({ status: 'started', startedAt }))

      expect(icons(container)).toEqual(['icon-loader'])
      expect(container.textContent).toContain('In progress…')
      expect(container.textContent).not.toContain('Interrupted')
    })

    it('reads as interrupted once past the stale-lock TTL', () => {
      const startedAt = new Date(
        Date.now() - CONNECTOR_SYNC_STALE_LOCK_TTL_MS - 60_000
      ).toISOString()
      const container = render(makeLog({ status: 'started', startedAt }))

      expect(icons(container)).toEqual(['icon-triangle-alert'])
      expect(container.textContent).toContain('Interrupted')
      expect(container.textContent).not.toContain('In progress…')
      expect(container.textContent).not.toContain('No changes')
    })
  })
})
