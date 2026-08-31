/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBrowserTimezone, mockIsValidTimezone, mockUseQuery } = vi.hoisted(() => ({
  mockGetBrowserTimezone: vi.fn(),
  mockIsValidTimezone: vi.fn(),
  mockUseQuery: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: mockUseQuery,
  useQueryClient: vi.fn(),
}))
vi.mock('@/lib/core/utils/timezone', () => ({
  getBrowserTimezone: mockGetBrowserTimezone,
  isValidTimezone: mockIsValidTimezone,
}))

import { useTimezone, useTimezoneState } from '@/hooks/queries/general-settings'

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
    vi.clearAllMocks()
    mockGetBrowserTimezone.mockReturnValue('America/Los_Angeles')
    mockIsValidTimezone.mockReturnValue(true)
  })

  afterEach(() => {
    for (const { container, root } of mountedRoots.splice(0)) {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('uses the browser timezone while no preference is saved', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: null } })

    expect(renderHookResult(useTimezone)).toBe('America/Los_Angeles')
    expect(renderHookResult(useTimezoneState)).toEqual({
      timezone: 'America/Los_Angeles',
      savedTimezone: null,
      status: 'ready',
    })
  })

  it('uses a saved timezone instead of the browser fallback', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: 'Asia/Kathmandu' } })

    expect(renderHookResult(useTimezone)).toBe('Asia/Kathmandu')
    expect(renderHookResult(useTimezoneState)).toEqual({
      timezone: 'Asia/Kathmandu',
      savedTimezone: 'Asia/Kathmandu',
      status: 'ready',
    })
    expect(mockGetBrowserTimezone).not.toHaveBeenCalled()
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

  it('reads the current setting again after it changes', () => {
    let timezone: string | null = 'America/New_York'
    mockUseQuery.mockImplementation(() => ({ data: { timezone } }))

    expect(renderHookResult(useTimezone)).toBe('America/New_York')
    timezone = 'Asia/Tokyo'
    expect(renderHookResult(useTimezone)).toBe('Asia/Tokyo')
    timezone = null
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
