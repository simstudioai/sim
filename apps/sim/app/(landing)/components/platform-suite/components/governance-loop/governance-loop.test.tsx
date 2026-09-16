/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span data-badge=''>{children}</span>,
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('@sim/emcn/icons', () => ({
  Building: () => <svg aria-hidden='true' />,
  Download: () => <svg aria-hidden='true' />,
}))

vi.mock('@/app/(landing)/components/shared/responsive-design-stage', () => ({
  ResponsiveDesignStage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/(landing)/hooks/use-motion-safe-cycle', async () => {
  const React = await import('react')
  return {
    useMotionSafeCycle: ({
      scheduleCycle,
    }: {
      scheduleCycle: () => { timers: ReturnType<typeof setTimeout>[]; totalMs: number }
    }) => {
      React.useEffect(() => {
        const cycle = scheduleCycle()
        return () => cycle.timers.forEach(clearTimeout)
      }, [])
    },
  }
})

import { GovernanceLoop } from '@/app/(landing)/components/platform-suite/components/governance-loop'

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('GovernanceLoop', () => {
  it('lands the workspaces, fills spend against the budget, and trips the near-limit status', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    act(() => {
      createRoot(host).render(<GovernanceLoop />)
    })

    expect(host.textContent).toContain('Organization')
    expect(host.textContent).toContain('Spend this month')
    const rows = () => [...host.querySelectorAll('tbody tr')]
    expect(rows()).toHaveLength(5)
    expect(rows().every((row) => row.className.includes('opacity-0'))).toBe(true)
    expect(host.textContent).toContain('$0 of $6,000')
    expect(host.textContent).not.toContain('Near limit')

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(rows().every((row) => row.className.includes('opacity-100'))).toBe(true)
    expect(host.textContent).toContain('$3,480 of $6,000')
    expect(host.textContent).toContain('58% of the org budget')
    expect(host.textContent).toContain('Near limit')
  })
})
