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

function AuditProbe({ organizationId }: { organizationId: string }) {
  const auditLogs = useAuditLogs(organizationId, {})
  const entries = auditLogs.data?.pages.flatMap((page) => page.data) ?? []

  return (
    <div>
      <span>{entries[0]?.description ?? ''}</span>
      {entries.length > 0 && <button type='button'>Export audit logs</button>}
    </div>
  )
}

function renderAuditLogs(organizationId: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuditProbe organizationId={organizationId} />
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
})
