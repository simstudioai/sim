import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  env: {
    ENABLE_INTERNAL_SCHEDULER: 'true',
    CRON_SECRET: 'test-secret',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    INTERNAL_SCHEDULER_INTERVAL_MS: '1000',
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Internal Scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ executedCount: 0 }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should poll schedules endpoint with correct authentication', async () => {
    const { startInternalScheduler, stopInternalScheduler } = await import('./internal-scheduler')

    startInternalScheduler()

    // Wait for the initial poll to complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/schedules/execute',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-secret',
          'User-Agent': 'sim-studio-internal-scheduler/1.0',
        }),
      })
    )

    stopInternalScheduler()
  })

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { startInternalScheduler, stopInternalScheduler } = await import('./internal-scheduler')

    // Should not throw
    startInternalScheduler()
    await new Promise((resolve) => setTimeout(resolve, 100))
    stopInternalScheduler()
  })

  it('should handle non-ok responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    const { startInternalScheduler, stopInternalScheduler } = await import('./internal-scheduler')

    // Should not throw
    startInternalScheduler()
    await new Promise((resolve) => setTimeout(resolve, 100))
    stopInternalScheduler()
  })
})

describe('shouldEnableInternalScheduler', () => {
  it('should return true when ENABLE_INTERNAL_SCHEDULER is true', async () => {
    const { shouldEnableInternalScheduler } = await import('./internal-scheduler')
    expect(shouldEnableInternalScheduler()).toBe(true)
  })
})
