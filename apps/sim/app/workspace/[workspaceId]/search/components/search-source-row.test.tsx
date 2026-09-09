/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'

vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))

import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'

const connect = vi.fn()
const manage = vi.fn()
let root: Root
let container: HTMLDivElement

function source(overrides: Partial<SearchSourceSummary> = {}): SearchSourceSummary {
  return {
    knowledgeBaseId: 'kb-search',
    connectorId: 'source-1',
    connectorType: 'confluence',
    sourceDescription: 'engineering.atlassian.net · ENG',
    accessMode: 'members',
    availability: 'available',
    enabled: true,
    isSyncing: false,
    lastSyncAt: null,
    hasSyncError: false,
    viewerDocumentCount: 0,
    viewerFailedDocumentCount: 0,
    viewerEmailVerified: true,
    connectionRequired: true,
    viewerMembership: 'invited',
    ...overrides,
  } as SearchSourceSummary
}

async function render(
  data = source(),
  props: {
    canAdmin?: boolean
    available?: boolean
    waiting?: boolean
    isPending?: boolean
    manageHref?: string
  } = {}
) {
  await act(async () =>
    root.render(
      <SearchSourceRow
        source={data}
        workspaceId='workspace-1'
        canAdmin={false}
        available
        waiting={false}
        isPending={false}
        onConnect={connect}
        onManage={manage}
        {...props}
      />
    )
  )
}

function button(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Search source viewer actions', () => {
  it.each(['invited', 'not_enrolled'] as const)(
    'lets a %s viewer connect their account',
    async (membership) => {
      await render(source({ viewerMembership: membership }))
      expect(document.body.textContent).toContain('engineering.atlassian.net · ENG')
      expect(document.body.textContent).toContain('Connect your account to search this source')
      await act(async () => button('Connect account')!.click())
      expect(connect).toHaveBeenCalledOnce()
      expect(button('Manage')).toBeUndefined()
    }
  )

  it('offers Reconnect and lets a waiting viewer reopen enrollment', async () => {
    await render(source({ viewerMembership: 'needs_reauth' }))
    expect(button('Reconnect')).toBeDefined()
    await render(source({ viewerMembership: 'needs_reauth' }), { waiting: true })
    expect(document.body.textContent).toContain('Finish connecting in the other tab')
    await act(async () => button('Open again')!.click())
    expect(connect).toHaveBeenCalledOnce()
    await render(source({ viewerMembership: 'needs_reauth' }), { waiting: true, isPending: true })
    expect(button('Open again')?.disabled).toBe(true)
  })

  it.each([
    { change: { availability: 'unavailable' as const }, status: 'Not available in this workspace' },
    { change: { enabled: false }, status: 'Syncing is paused' },
    { change: { viewerEmailVerified: false }, status: 'Verify your email' },
    { change: { viewerMembership: 'unverified_email' as const }, status: 'Verify your email' },
    { change: { viewerMembership: 'revoked' as const }, status: 'Your access was removed' },
    { change: { viewerMembership: null }, status: 'Needs admin attention' },
  ])('blocks connection when $status', async ({ change, status }) => {
    await render(source({ ...change, isSyncing: true, hasSyncError: true }))
    expect(document.body.textContent).toContain(status)
    expect(button('Connect account')).toBeUndefined()
    expect(button('Reconnect')).toBeUndefined()
    expect(connect).not.toHaveBeenCalled()
  })

  it('blocks a cached available source when the client feature is disabled', async () => {
    await render(source(), { available: false })
    expect(document.body.textContent).toContain('Not available in this workspace')
    expect(button('Connect account')).toBeUndefined()
  })

  it('prioritizes viewer connection over crawler health for central Confluence identity', async () => {
    await render(source({ accessMode: 'admin', hasSyncError: true, isSyncing: true }))
    expect(document.body.textContent).toContain('Connect your account to search this source')
    expect(button('Connect account')).toBeDefined()
  })

  it.each(['google_drive', 'gitlab'])(
    'shows central %s status without prompting for a member connection',
    async (connectorType) => {
      await render(
        source({
          connectorType,
          accessMode: 'admin',
          connectionRequired: false,
          viewerMembership: null,
          viewerDocumentCount: 1,
        })
      )
      expect(document.body.textContent).toContain('1 searchable document')
      expect(document.body.textContent).not.toContain('Needs admin attention')
      expect(button('Connect account')).toBeUndefined()
    }
  )

  it.each([
    {
      change: { hasSyncError: true, viewerDocumentCount: 4 },
      status: 'Sync needs attention · 4 searchable documents',
    },
    { change: { hasSyncError: true }, status: 'Sync needs admin attention' },
    {
      change: { viewerFailedDocumentCount: 1 },
      status: "1 document couldn't be indexed",
    },
    {
      change: { viewerFailedDocumentCount: 2, viewerDocumentCount: 4 },
      status: "2 documents couldn't be indexed · 4 searchable documents",
    },
    {
      change: { isSyncing: true, viewerDocumentCount: 4 },
      status: 'Indexing · 4 searchable documents',
    },
    { change: { isSyncing: true }, status: 'Indexing' },
    { change: { viewerDocumentCount: 4 }, status: '4 searchable documents' },
    { change: { lastSyncAt: '2026-09-05T12:00:00Z' }, status: 'No searchable documents yet' },
    { change: {}, status: 'Waiting for the first sync' },
  ])('reports $status after connection', async ({ change, status }) => {
    await render(source({ viewerMembership: 'connected', ...change }))
    expect(document.body.textContent).toContain(status)
    expect(button('Connect account')).toBeUndefined()
  })

  it('gives admins Manage after connecting and keeps management secondary before connecting', async () => {
    await render(source(), { canAdmin: true })
    expect(button('Connect account')).toBeDefined()
    expect(button('Confluence source actions')).toBeDefined()
    expect(button('Manage')).toBeUndefined()
    await render(source({ viewerMembership: 'connected' }), { canAdmin: true })
    await act(async () => button('Manage')!.click())
    expect(manage).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
  })

  it('opens source details through a row link while preserving the separate connection action', async () => {
    const manageHref = '/o/org-1/settings/integrations/sources/source-1'
    await render(source(), { canAdmin: true, manageHref })
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe(manageHref)
    expect(link?.getAttribute('aria-label')).toBe('Open engineering.atlassian.net · ENG')
    expect(button('Manage')).toBeUndefined()
    expect(button('Confluence source actions')).toBeUndefined()
    expect(link?.contains(button('Connect account')!)).toBe(false)
    await act(async () => button('Connect account')!.click())
    expect(connect).toHaveBeenCalledOnce()
    expect(manage).not.toHaveBeenCalled()
  })

  it('does not expose management navigation to a non-admin', async () => {
    await render(source(), {
      canAdmin: false,
      manageHref: '/o/org-1/settings/integrations/sources/source-1',
    })
    expect(container.querySelector('a')).toBeNull()
    expect(button('Connect account')).toBeDefined()
  })

  it.each([false, true])(
    'retains the legacy knowledge-base link for canAdmin=%s',
    async (canAdmin) => {
      await render(source({ connectorType: 'airtable' }), { canAdmin })
      const link = document.querySelector('a')
      expect(link?.getAttribute('href')).toBe('/workspace/workspace-1/knowledge/kb-search')
      expect(link?.textContent).toBe(canAdmin ? 'Manage' : 'View')
      expect(document.body.textContent).toContain('Available in its knowledge base')
      expect(button('Connect account')).toBeUndefined()
    }
  )
})
