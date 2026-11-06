/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { emcnMock, emcnMockFns } from '@sim/testing/mocks/emcn.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOrganizationDataRetentionContract,
  type UpdateOrganizationDataRetentionBody,
} from '@/lib/api/contracts/organization'
import type { PolicyDraft } from '@/ee/data-retention/lib/policy-draft'

vi.mock('@sim/emcn', () => emcnMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: () => ({ data: [], isPending: false }),
}))
vi.mock(
  '@/platform/app/(shell)/settings/_components/sections/data-retention/policy-detail',
  () => ({
    PolicyDetail: ({
      draft,
      changed,
      onChange,
      onSave,
      onRemove,
    }: {
      draft: PolicyDraft
      changed: boolean
      onChange: (draft: PolicyDraft) => void
      onSave: () => void
      onRemove: () => Promise<void>
    }): ReactNode => (
      <div>
        <output>{draft.logDays}</output>
        <button type='button' onClick={() => onChange({ ...draft, logDays: '7' })}>
          keep logs 7 days
        </button>
        <button type='button' onClick={() => onChange({ ...draft, logDays: '14' })}>
          keep logs 14 days
        </button>
        <button type='button' disabled={!changed} onClick={onSave}>
          Save
        </button>
        <button
          type='button'
          onClick={() =>
            void onRemove().catch((error: Error) => {
              window.document.body.dataset.removeError = error.message
            })
          }
        >
          Remove
        </button>
      </div>
    ),
  })
)

import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import DataRetentionSection from '@/platform/app/(shell)/settings/_components/sections/data-retention/data-retention-section'

const days = (count: number) => count * 24

function retentionDocument(logDays: number) {
  const hours = {
    logRetentionHours: days(logDays),
    softDeleteRetentionHours: days(30),
    taskCleanupHours: days(30),
  }
  return {
    isEnterprise: true,
    configured: { ...hours, retentionOverrides: [], piiRedaction: { rules: [] } },
    effective: { ...hours, retentionOverrides: [], piiRedaction: { rules: [] } },
  }
}

const ORGANIZATION = {
  organization: { id: 'org-1' },
  deployment: { billingEnabled: false },
} as unknown as SettingsSectionProps['organization']

/** The saved document on the far side of the real query and mutation hooks. */
const server = {
  document: retentionDocument(30),
  writes: [] as UpdateOrganizationDataRetentionBody[],
  /** What the route makes of a write; by default it stores what it was sent. */
  answer: (body: UpdateOrganizationDataRetentionBody) =>
    retentionDocument((body.logRetentionHours ?? 0) / 24),
  read: async (): Promise<unknown> => ({ success: true, data: server.document }),
}

describe('DataRetentionSection across saves', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  const click = (name: string) =>
    act(async () => {
      const target = Array.from(container.querySelectorAll('button')).find((node) =>
        node.textContent?.includes(name)
      )
      if (!target) throw new Error(`No button named ${name}: ${container.textContent}`)
      target.click()
      await flushMacrotask()
    })

  /** Query results reach React on a timer, after the read itself has finished. */
  async function settle() {
    await act(async () => {
      await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
      await flushMacrotask()
    })
  }

  async function saveLogs(logDays: 7 | 14) {
    await click('Organization')
    await click(`keep logs ${logDays} days`)
    await click('Save')
    await settle()
  }

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    stubResizeObserver()
    server.document = retentionDocument(30)
    server.writes = []
    server.answer = (body) => retentionDocument((body.logRetentionHours ?? 0) / 24)
    server.read = async () => ({ success: true, data: server.document })
    delete window.document.body.dataset.removeError
    apiClientRequestMockFns.mockRequestJson
      .mockReset()
      .mockImplementation(
        async (contract: unknown, request: { body?: UpdateOrganizationDataRetentionBody }) => {
          if (contract === getOrganizationDataRetentionContract) return server.read()
          const body = request.body as UpdateOrganizationDataRetentionBody
          server.writes.push(body)
          server.document = server.answer(body)
          return { success: true, data: server.document }
        }
      )
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DataRetentionSection organization={ORGANIZATION} subpath={[]} query={{}} />
        </QueryClientProvider>
      )
    })
    await settle()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    queryClient.clear()
  })

  it('adopts what another admin saved after this admin has saved', async () => {
    await saveLogs(7)
    expect(container.textContent).toContain('Log 7d')

    server.document = retentionDocument(60)
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await settle()

    expect(container.textContent).toContain('Log 60d')
  })

  it('says so and writes nothing when a later save finds the policy changed, then saves once chosen', async () => {
    await saveLogs(7)
    server.document = retentionDocument(60)

    await saveLogs(14)

    expect(server.writes).toHaveLength(1)
    expect(emcnMockFns.mockToast.error).toHaveBeenCalledWith(
      'This policy changed while you were editing. Nothing was saved.'
    )
    expect(container.textContent).toContain('changed while you were editing')

    await click('Keep my edits')
    await click('Save')
    await settle()

    expect(server.writes.map((write) => write.logRetentionHours)).toEqual([days(7), days(14)])
  })

  it('keeps saving a policy whose stored form differs from what was sent', async () => {
    server.answer = () => retentionDocument(90)

    await saveLogs(7)
    expect(container.textContent).toContain('Log 90d')

    server.answer = (body) => retentionDocument((body.logRetentionHours ?? 0) / 24)
    await saveLogs(14)

    expect(server.writes.map((write) => write.logRetentionHours)).toEqual([days(7), days(14)])
    expect(emcnMockFns.mockToast.error).not.toHaveBeenCalled()
  })

  describe('the read before a write fails', () => {
    async function failNextReads(start: () => Promise<void>) {
      server.read = async () => {
        throw new Error('read failed')
      }
      await start()
      await settle()
    }

    it('writes nothing over the document from before the failure, and says so', async () => {
      server.document = retentionDocument(60)
      await click('Organization')
      await click('keep logs 7 days')
      await failNextReads(() => click('Save'))

      expect(server.writes).toEqual([])
      expect(emcnMockFns.mockToast.error).toHaveBeenCalledWith(
        'Could not confirm the latest retention settings. Nothing was saved.'
      )
    })

    it('removes nothing over the document from before the failure', async () => {
      await click('Organization')
      await failNextReads(() => click('Remove'))

      expect(server.writes).toEqual([])
      expect(window.document.body.dataset.removeError).toBe(
        'Could not confirm the latest retention settings.'
      )
    })
  })

  it('shows the route answer without waiting on the read that follows the save', async () => {
    server.answer = () => retentionDocument(90)
    await click('Organization')
    await click('keep logs 7 days')
    const pendingRead = new Promise(() => {})
    const firstRead = server.read
    let reads = 0
    server.read = () => (++reads === 1 ? firstRead() : pendingRead)

    await click('Save')

    expect(container.textContent).toContain('Log 90d')
  })
})
