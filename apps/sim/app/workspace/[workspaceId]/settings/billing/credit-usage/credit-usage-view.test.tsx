/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseUsageLogs } = vi.hoisted(() => ({
  mockUseUsageLogs: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Calendar: () => null,
  ChipCombobox: () => <div />,
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverAnchor: () => null,
  PopoverContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  chipVariants: () => '',
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  toast: { error: vi.fn(), info: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('nuqs', () => ({
  useQueryStates: () => [{ period: '30d', startDate: null, endDate: null }, vi.fn()],
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))

vi.mock('@/hooks/queries/usage-logs', () => ({
  useUsageLogs: mockUseUsageLogs,
}))

import { CreditUsageView } from '@/app/workspace/[workspaceId]/settings/billing/credit-usage/credit-usage-view'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

function renderView() {
  act(() => root.render(<CreditUsageView />))
}

describe('CreditUsageView summary states', () => {
  it('does not present zero as the total while the defining query is pending', () => {
    mockUseUsageLogs.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchingNextPage: false,
      isLoading: true,
      isPlaceholderData: false,
    })

    renderView()

    expect(container.textContent).toContain('Total: Loading…')
    expect(container.textContent).not.toContain('Total: 0')
  })

  it('does not present the prior period total while the next period is pending', () => {
    mockUseUsageLogs.mockReturnValue({
      data: { pages: [{ logs: [], summary: { totalCredits: 987_654 } }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: true,
    })

    renderView()

    expect(container.textContent).toContain('Total: Updating…')
    expect(container.textContent).not.toContain('987,654')
  })

  it('marks the total unavailable when the query fails', () => {
    mockUseUsageLogs.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: true,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: false,
    })

    renderView()

    expect(container.textContent).toContain('Total: Unavailable')
    expect(container.textContent).toContain("Couldn't load credit usage.")
  })

  it('keeps cached usage visible when a background refresh fails', () => {
    mockUseUsageLogs.mockReturnValue({
      data: {
        pages: [
          {
            logs: [
              {
                id: 'usage-1',
                createdAt: '2026-08-31T12:00:00.000Z',
                source: 'workflow',
                workflowName: 'Cached workflow',
                creditCost: 42,
                hasCost: true,
              },
            ],
            summary: { totalCredits: 42 },
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: true,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: false,
    })

    renderView()

    expect(container.textContent).toContain('Total: 42')
    expect(container.textContent).not.toContain('Unavailable')
    expect(container.textContent).not.toContain("Couldn't load credit usage.")
  })
})
