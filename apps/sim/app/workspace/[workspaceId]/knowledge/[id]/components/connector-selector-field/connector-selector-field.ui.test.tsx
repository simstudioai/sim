/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAll: vi.fn(),
  change: vi.fn(),
  hasMore: true,
  options: null as { id: string; label: string }[] | null,
  error: null as Error | null,
  refetch: vi.fn(),
  loadMore: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ organizationId: 'org-1' }) }))
vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions: () => ({
    data:
      mocks.options ??
      (mocks.hasMore
        ? [{ id: 'ENG', label: 'Engineering' }]
        : [
            { id: 'ENG', label: 'Engineering' },
            { id: 'OPS', label: 'Operations' },
          ]),
    hasMore: mocks.hasMore,
    isLoading: false,
    isFetching: false,
    isLoadingAll: false,
    truncated: false,
    loadAll: mocks.loadAll,
    loadMore: mocks.loadMore,
    refetch: mocks.refetch,
    error: mocks.error,
  }),
  useSelectorOptionDetails: () => ({ data: [] }),
  useSelectorOptionDetail: () => ({}),
}))

import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/connector-selector-field'

function ControlledSelector() {
  const [value, setValue] = useState<string[]>([])
  return (
    <ConnectorSelectorField
      field={{
        id: 'spaces',
        title: 'Spaces',
        type: 'selector',
        selectorKey: 'confluence.spaces',
        multi: true,
        allowSelectAll: true,
      }}
      credentialId='credential-1'
      value={value}
      onChange={(next, labels) => {
        mocks.change(next, labels)
        mocks.hasMore = false
        setValue(Array.isArray(next) ? next : [])
      }}
      sourceConfig={{}}
      configFields={[]}
      canonicalModes={{}}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasMore = true
  mocks.options = null
  mocks.error = null
})

it('selects all pages with the keyboard, announces selection, and toggles it off', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const originalScroll = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = vi.fn()
  mocks.loadAll.mockResolvedValue({
    status: 'complete',
    options: [
      { id: 'ENG', label: 'Engineering' },
      { id: 'OPS', label: 'Operations' },
    ],
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<ControlledSelector />))
    expect(container.textContent).not.toContain('Select all')
    expect(container.textContent).not.toContain('Clear')
    const trigger = container.querySelector('[role="combobox"]')
    expect(trigger).not.toBeNull()
    await act(async () =>
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    )
    expect(document.querySelector('[role="option"]')?.textContent).toBe('All')
    await act(async () =>
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(document.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('true')
    expect(mocks.loadAll).toHaveBeenCalledOnce()
    expect(mocks.change).toHaveBeenCalledWith(
      ['ENG', 'OPS'],
      [
        { id: 'ENG', label: 'Engineering' },
        { id: 'OPS', label: 'Operations' },
      ]
    )
    await act(async () =>
      document
        .querySelector('[role="option"]')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    )
    expect(mocks.change).toHaveBeenLastCalledWith([], [])
    expect(document.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('false')
    expect(mocks.loadAll).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    HTMLElement.prototype.scrollIntoView = originalScroll
    vi.unstubAllGlobals()
  }
})

it.each(['empty', 'error'] as const)(
  'shows the initial %s state without All and allows failed lists to retry',
  async (state) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const originalScroll = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = vi.fn()
    mocks.options = []
    mocks.hasMore = false
    mocks.error = state === 'error' ? new Error('Provider unavailable') : null
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ControlledSelector />))
      const trigger = container.querySelector<HTMLElement>('[role="combobox"]')
      expect(trigger).not.toBeNull()
      await act(async () => trigger?.click())
      expect(document.querySelector('[role="listbox"]')).not.toBeNull()
      expect(document.querySelector('[role="option"]')).toBeNull()
      expect(mocks.loadAll).not.toHaveBeenCalled()

      const retry = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Try again'
      )
      if (state === 'empty') {
        expect(document.body.textContent).toContain('No spaces found')
        expect(retry).toBeUndefined()
        return
      }
      expect(document.body.textContent).toContain('Provider unavailable')
      expect(retry).toBeDefined()
      await act(async () => retry?.click())
      expect(mocks.refetch).toHaveBeenCalledOnce()
      expect(mocks.loadMore).not.toHaveBeenCalled()
      mocks.error = null
      mocks.options = [{ id: 'ENG', label: 'Engineering' }]
      await act(async () => root.render(<ControlledSelector />))
      expect(
        Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)
      ).toEqual(['All', 'Engineering'])
      expect(
        Array.from(document.querySelectorAll('button')).some(
          (button) => button.textContent?.trim() === 'Try again'
        )
      ).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      HTMLElement.prototype.scrollIntoView = originalScroll
      vi.unstubAllGlobals()
    }
  }
)
