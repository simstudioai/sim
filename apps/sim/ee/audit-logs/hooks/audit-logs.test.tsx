/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { type AuditLogPage, listAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import { useAuditLogs } from '@/ee/audit-logs/hooks/audit-logs'

function createDeferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const AUDIT_PAGE_A: AuditLogPage = {
  success: true,
  data: [
    {
      id: 'audit-a',
      workspaceId: null,
      actorId: 'user-a',
      actorName: 'Actor A',
      actorEmail: 'actor-a@example.com',
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: 'org-a',
      resourceName: 'Organization A',
      description: 'Updated Organization A',
      metadata: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

function AuditProbe({
  organizationId,
  workspaceId,
  search,
  enabled = true,
}: {
  organizationId: string
  workspaceId?: string
  search?: string
  enabled?: boolean
}) {
  const auditLogs = useAuditLogs(organizationId, { workspaceId, search }, enabled)
  const entries = auditLogs.data?.pages.flatMap((page) => page.data) ?? []

  return (
    <div>
      <span>{entries[0]?.description ?? ''}</span>
      {entries.length > 0 && <button type='button'>Export audit logs</button>}
    </div>
  )
}

interface RenderOptions {
  workspaceId?: string
  search?: string
  enabled?: boolean
}

function renderAuditLogs(organizationId: string, options: RenderOptions = {}) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuditProbe
          organizationId={organizationId}
          workspaceId={options.workspaceId}
          search={options.search}
          enabled={options.enabled ?? true}
        />
      </QueryClientProvider>
    )
  })
}

async function flushQueries() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await Promise.resolve()
      await sleep(0)
    }
  })
}

describe('useAuditLogs identity transitions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
  })

  it('clears org A audit entries and export actions while org B loads', async () => {
    const auditPageB = createDeferred<AuditLogPage>()
    mockRequestJson.mockImplementation(
      (contract: unknown, input: { query?: { organizationId?: string } }) => {
        if (contract !== listAuditLogsContract) throw new Error('Unexpected contract')
        return input.query?.organizationId === 'org-a'
          ? Promise.resolve(AUDIT_PAGE_A)
          : auditPageB.promise
      }
    )

    renderAuditLogs('org-a')
    await flushQueries()

    expect(container).toHaveTextContent('Updated Organization A')
    expect(container.querySelector('button')).toHaveTextContent('Export audit logs')

    renderAuditLogs('org-b')
    await flushQueries()

    expect(container).not.toHaveTextContent('Updated Organization A')
    expect(container.querySelector('button')).toBeNull()
    expect(mockRequestJson).toHaveBeenCalledWith(
      listAuditLogsContract,
      expect.objectContaining({
        query: expect.objectContaining({ organizationId: 'org-b' }),
      })
    )
  })

  /** Blanking the feed on each keystroke is what the placeholder exists to stop. */
  it('holds the current entries while a filter change loads, within one scope', async () => {
    const filteredPage = createDeferred<AuditLogPage>()
    mockRequestJson.mockImplementation(
      (contract: unknown, input: { query?: { search?: string } }) => {
        if (contract !== listAuditLogsContract) throw new Error('Unexpected contract')
        return input.query?.search ? filteredPage.promise : Promise.resolve(AUDIT_PAGE_A)
      }
    )

    renderAuditLogs('org-a')
    await flushQueries()
    expect(container).toHaveTextContent('Updated Organization A')

    renderAuditLogs('org-a', { search: 'canary' })
    await flushQueries()

    expect(container).toHaveTextContent('Updated Organization A')
  })

  /**
   * The other side of that rule. A workspace is a scope, not a filter: holding the
   * organization-wide rows while the scoped page loads would show, under a
   * workspace-scoped URL, entries that scope does not cover — with Export armed
   * against them, since it gates on this list being non-empty.
   */
  it('clears the entries when the workspace scope changes, within one organization', async () => {
    const scopedPage = createDeferred<AuditLogPage>()
    mockRequestJson.mockImplementation(
      (contract: unknown, input: { query?: { workspaceId?: string } }) => {
        if (contract !== listAuditLogsContract) throw new Error('Unexpected contract')
        return input.query?.workspaceId ? scopedPage.promise : Promise.resolve(AUDIT_PAGE_A)
      }
    )

    renderAuditLogs('org-a')
    await flushQueries()
    expect(container).toHaveTextContent('Updated Organization A')

    renderAuditLogs('org-a', { workspaceId: 'workspace-a' })
    await flushQueries()

    expect(container).not.toHaveTextContent('Updated Organization A')
    expect(container.querySelector('button')).toBeNull()
  })

  /**
   * The scope a link asks for is a ceiling, not a hint. A workspace id that no longer
   * resolves must leave the feed closed rather than answering with the whole
   * organization's history under a URL that still claims to be scoped.
   */
  it('never queries unscoped while a workspace scope is unresolved', async () => {
    mockRequestJson.mockResolvedValue(AUDIT_PAGE_A)

    renderAuditLogs('org-a', { enabled: false })
    await flushQueries()

    expect(mockRequestJson).not.toHaveBeenCalled()
    expect(container).not.toHaveTextContent('Updated Organization A')
  })
})
