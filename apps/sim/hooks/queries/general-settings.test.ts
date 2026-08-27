/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBrowserTimezone, mockUseQuery } = vi.hoisted(() => ({
  mockGetBrowserTimezone: vi.fn(),
  mockUseQuery: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: mockUseQuery,
  useQueryClient: vi.fn(),
}))
vi.mock('@/lib/core/utils/timezone', () => ({ getBrowserTimezone: mockGetBrowserTimezone }))

import { useTimezone } from '@/hooks/queries/general-settings'

describe('useTimezone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBrowserTimezone.mockReturnValue('America/Los_Angeles')
  })

  it('uses the browser timezone while no preference is saved', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: null } })

    expect(useTimezone()).toBe('America/Los_Angeles')
  })

  it('uses a saved timezone instead of the browser fallback', () => {
    mockUseQuery.mockReturnValue({ data: { timezone: 'Asia/Kathmandu' } })

    expect(useTimezone()).toBe('Asia/Kathmandu')
    expect(mockGetBrowserTimezone).not.toHaveBeenCalled()
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
})
