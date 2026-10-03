/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { reactQueryMock, reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBrowserTimezone, mockIsValidTimezone } = vi.hoisted(() => ({
  mockGetBrowserTimezone: vi.fn(),
  mockIsValidTimezone: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => reactQueryMock)
vi.mock('@/lib/core/utils/timezone', () => ({
  getBrowserTimezone: mockGetBrowserTimezone,
  isValidTimezone: mockIsValidTimezone,
}))

import { useTimezone, useTimezoneState } from '@/hooks/queries/general-settings'

const mockUseQuery = reactQueryMockFns.mockUseQuery

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

function renderHookResult<T>(useHook: () => T): T {
  const container = document.createElement('div')
  const root = createRoot(container)
  let result: T | undefined

  function Probe() {
    result = useHook()
    return null
  }

  act(() => root.render(<Probe />))
  mountedRoots.push({ container, root })
  return result as T
}

describe('useTimezone', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mockGetBrowserTimezone.mockReturnValue('America/Los_Angeles')
    mockIsValidTimezone.mockReturnValue(true)
  })

  afterEach(() => {
    for (const { container, root } of mountedRoots.splice(0)) {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('uses the browser timezone for display while preserving an invalid preference', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: 'Not/AZone' } })
    mockIsValidTimezone.mockReturnValue(false)

    expect(renderHookResult(useTimezoneState)).toEqual({
      timezone: 'America/Los_Angeles',
      savedTimezone: 'Not/AZone',
      status: 'invalid',
    })
    expect(renderHookResult(useTimezone)).toBe('America/Los_Angeles')
  })

  it('distinguishes an unresolved preference from an explicit browser fallback', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isError: false })

    expect(renderHookResult(useTimezoneState)).toEqual({
      timezone: 'America/Los_Angeles',
      savedTimezone: null,
      status: 'loading',
    })
  })

  it('reports an unavailable preference instead of treating it as resolved', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isError: true })

    expect(renderHookResult(useTimezoneState)).toEqual({
      timezone: 'America/Los_Angeles',
      savedTimezone: null,
      status: 'error',
    })
  })
})
