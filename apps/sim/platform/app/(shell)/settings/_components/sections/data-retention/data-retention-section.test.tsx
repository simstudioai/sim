/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PolicyDraft } from '@/ee/data-retention/lib/policy-draft'

const mocks = vi.hoisted(() => ({
  retention: { current: undefined as unknown },
  refetch: vi.fn(),
  mutateAsync: vi.fn(),
}))

vi.mock('@sim/emcn', () => emcnMock)
vi.mock('@/ee/data-retention/hooks/data-retention', () => ({
  useOrganizationRetention: () => ({
    data: mocks.retention.current,
    isLoading: false,
    isFetching: false,
    refetch: mocks.refetch,
  }),
  useUpdateOrganizationRetention: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesQuery: () => ({
    data: [
      { id: 'ws-1', name: 'One', organizationId: 'org-1' },
      { id: 'ws-2', name: 'Two', organizationId: 'org-1' },
    ],
    isPending: false,
  }),
}))
vi.mock(
  '@/platform/app/(shell)/settings/_components/sections/data-retention/policy-detail',
  () => ({
    PolicyDetail: ({
      draft,
      changed,
      onChange,
      onSave,
    }: {
      draft: PolicyDraft
      changed: boolean
      onChange: (draft: PolicyDraft) => void
      onSave: () => void
    }): ReactNode => (
      <div>
        <output>{draft.logDays}</output>
        <button type='button' onClick={() => onChange({ ...draft, logDays: '7' })}>
          edit log days
        </button>
        <button type='button' disabled={!changed} onClick={onSave}>
          Save
        </button>
      </div>
    ),
  })
)

import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import DataRetentionSection from '@/platform/app/(shell)/settings/_components/sections/data-retention/data-retention-section'

const HOURS_30_DAYS = 720
const HOURS_60_DAYS = 1440

function retentionDocument(
  logRetentionHours = HOURS_30_DAYS,
  retentionOverrides: Array<{ workspaceId: string; logRetentionHours: number }> = []
) {
  return {
    isEnterprise: true,
    effective: {
      logRetentionHours,
      softDeleteRetentionHours: HOURS_30_DAYS,
      taskCleanupHours: HOURS_30_DAYS,
    },
    configured: { retentionOverrides, piiRedaction: { rules: [] } },
  }
}

const ORGANIZATION = {
  organization: { id: 'org-1' },
  deployment: { billingEnabled: false },
} as unknown as SettingsSectionProps['organization']

describe('DataRetentionSection', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (name: string) =>
    Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes(name)
    )
  const click = (name: string) =>
    act(async () => {
      const target = button(name)
      if (!target) throw new Error(`No button named ${name}: ${container.textContent}`)
      target.click()
    })
  const render = () =>
    act(async () => {
      root.render(<DataRetentionSection organization={ORGANIZATION} subpath={[]} query={{}} />)
    })

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    mocks.retention.current = retentionDocument()
    mocks.mutateAsync.mockReset().mockResolvedValue({})
    mocks.refetch.mockReset().mockImplementation(async () => ({ data: mocks.retention.current }))
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps the override another admin added when saving a tab opened before it', async () => {
    await render()
    await click('Organization')
    await click('edit log days')
    mocks.retention.current = retentionDocument(HOURS_30_DAYS, [
      { workspaceId: 'ws-2', logRetentionHours: HOURS_60_DAYS },
    ])
    await render()
    await click('Save')

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mocks.mutateAsync.mock.calls[0][0].settings).toMatchObject({
      logRetentionHours: 7 * 24,
      retentionOverrides: [{ workspaceId: 'ws-2', logRetentionHours: HOURS_60_DAYS }],
    })
  })

  it('reads the latest document at save, for an idle tab nothing refetched', async () => {
    await render()
    await click('Organization')
    await click('edit log days')
    mocks.retention.current = retentionDocument(HOURS_30_DAYS, [
      { workspaceId: 'ws-2', logRetentionHours: HOURS_60_DAYS },
    ])
    mocks.refetch.mockImplementation(async () => ({ data: mocks.retention.current }))
    await click('Save')

    expect(mocks.refetch).toHaveBeenCalled()
    expect(mocks.mutateAsync.mock.calls[0][0].settings.retentionOverrides).toEqual([
      { workspaceId: 'ws-2', logRetentionHours: HOURS_60_DAYS },
    ])
  })

  it('writes nothing when the read at save cannot confirm the document', async () => {
    await render()
    await click('Organization')
    await click('edit log days')
    mocks.refetch.mockImplementation(async () => ({ data: undefined, error: new Error('down') }))
    await click('Save')

    expect(mocks.mutateAsync).not.toHaveBeenCalled()
    expect(container.querySelector('output')?.textContent).toBe('7')
  })

  describe('another admin changes the policy being edited', () => {
    async function editThenConflict() {
      await render()
      await click('Organization')
      await click('edit log days')
      mocks.retention.current = retentionDocument(HOURS_60_DAYS)
      await render()
    }

    it('keeps the edit, flags the conflict and blocks the save', async () => {
      await editThenConflict()

      expect(container.querySelector('output')?.textContent).toBe('7')
      expect(container.textContent).toContain('changed while you were editing')
      await click('Save')
      expect(mocks.mutateAsync).not.toHaveBeenCalled()
    })

    it('saves the edit once the admin chooses to keep it', async () => {
      await editThenConflict()
      await click('Keep my edits')
      await click('Save')

      expect(mocks.mutateAsync.mock.calls[0][0].settings.logRetentionHours).toBe(7 * 24)
    })

    it('drops the edit once the admin chooses the latest', async () => {
      await editThenConflict()
      await click('Use the latest')

      expect(container.querySelector('output')?.textContent).toBe('60')
      expect(container.textContent).not.toContain('changed while you were editing')
    })

    it('stays quiet when a different policy changed', async () => {
      await render()
      await click('Organization')
      await click('edit log days')
      mocks.retention.current = retentionDocument(HOURS_30_DAYS, [
        { workspaceId: 'ws-2', logRetentionHours: HOURS_60_DAYS },
      ])
      await render()

      expect(container.textContent).not.toContain('changed while you were editing')
    })
  })

  it('adopts the newer document while the open policy holds no edits', async () => {
    await render()
    await click('Organization')
    mocks.retention.current = retentionDocument(HOURS_60_DAYS)
    await render()

    expect(container.querySelector('output')?.textContent).toBe('60')
  })
})
