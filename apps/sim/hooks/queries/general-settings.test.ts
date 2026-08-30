/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('useTimezone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBrowserTimezone.mockReturnValue('America/Los_Angeles')
    mockIsValidTimezone.mockReturnValue(true)
  })

  it('uses the browser timezone while no preference is saved', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: null } })

    expect(useTimezone()).toBe('America/Los_Angeles')
    expect(useTimezoneState()).toEqual({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
  })

  it('uses a saved timezone instead of the browser fallback', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: 'Asia/Kathmandu' } })

    expect(useTimezone()).toBe('Asia/Kathmandu')
    expect(mockGetBrowserTimezone).not.toHaveBeenCalled()
  })

  it('uses the browser timezone when the saved preference is invalid', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: 'Not/AZone' } })
    mockIsValidTimezone.mockReturnValue(false)

    expect(useTimezoneState()).toEqual({
      timezone: 'America/Los_Angeles',
      status: 'ready',
    })
  })

  it('reads the current setting again after it changes', () => {
    let timezone: string | null = 'America/New_York'
    mockUseQuery.mockImplementation(() => ({ data: { timezone } }))

    expect(useTimezone()).toBe('America/New_York')
    timezone = 'Asia/Tokyo'
    expect(useTimezone()).toBe('Asia/Tokyo')
    timezone = null
    expect(useTimezone()).toBe('America/Los_Angeles')
  })

  it('distinguishes an unresolved preference from an explicit browser fallback', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isError: false })

    expect(useTimezoneState()).toEqual({
      timezone: 'America/Los_Angeles',
      status: 'loading',
    })
  })

  it('reports an unavailable preference instead of treating it as resolved', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isError: true })

    expect(useTimezoneState()).toEqual({
      timezone: 'America/Los_Angeles',
      status: 'error',
    })
  })
})
