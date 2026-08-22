/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseStatusPage } = vi.hoisted(() => ({
  mockUseStatusPage: vi.fn(),
}))

vi.mock('@/hooks/queries/status-page', () => ({
  useStatusPage: mockUseStatusPage,
}))

import { StatusNotice } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/status-notice/status-notice'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mockUseStatusPage.mockReturnValue({ data: undefined, error: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

function render() {
  act(() => root.render(<StatusNotice />))
}

describe('StatusNotice', () => {
  it('shows the local status alert without fetching live status in preview mode', () => {
    act(() => root.render(<StatusNotice preview />))

    const notice = container.querySelector('[role="alert"]')
    expect(notice?.textContent).toContain('Sim is having issues')
    expect(notice?.className).toContain('bg-[var(--terminal-status-error-bg)]')
    expect(notice?.className).toContain('border-[var(--terminal-status-error-border)]')
    expect(container.querySelector('svg')?.classList.contains('text-[var(--text-icon)]')).toBe(true)
    expect(mockUseStatusPage).toHaveBeenCalledWith({ enabled: false })
  })

  it('stays hidden while loading and for operational or minor incidents', () => {
    render()
    expect(container.textContent).toBe('')

    mockUseStatusPage.mockReturnValue({
      data: { status: { description: 'All Systems Operational', indicator: 'none' } },
      error: null,
    })
    render()

    expect(container.textContent).toBe('')

    mockUseStatusPage.mockReturnValue({
      data: { status: { description: 'Minor Service Outage', indicator: 'minor' } },
      error: null,
    })
    render()

    expect(container.textContent).toBe('')
  })

  it('shows the notice for a major incident and opens the status page', () => {
    mockUseStatusPage.mockReturnValue({
      data: { status: { description: 'Major Service Outage', indicator: 'major' } },
      error: null,
    })

    render()

    const notice = container.querySelector('[role="alert"]')
    const action = container.querySelector<HTMLAnchorElement>('a')
    expect(notice?.className).toContain('border-[var(--terminal-status-error-border)]')
    expect(notice?.className).toContain('shadow-[var(--shadow-overlay)]')
    expect(notice?.className).toContain(
      '[--surface-hover:color-mix(in_srgb,var(--text-error)_8%,transparent)]'
    )
    expect(action?.textContent).toContain('View status')
    expect(action?.className).not.toContain('bg-[var(--text-error)]')
    expect(action?.getAttribute('href')).toBe('https://status.sim.ai')
    expect(action?.getAttribute('target')).toBe('_blank')
    expect(action?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('stays hidden when the optional status query fails', () => {
    mockUseStatusPage.mockReturnValue({
      data: undefined,
      error: new Error('status unavailable'),
    })

    render()

    expect(container.textContent).toBe('')
  })
})
