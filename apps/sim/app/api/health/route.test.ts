/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  it('returns an ok status payload', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    })
  })

  it('returns the E2E run identity when configured', async () => {
    vi.stubEnv('E2E_RUN_ID', 'run-health-check')
    try {
      const response = await GET()
      await expect(response.json()).resolves.toMatchObject({
        status: 'ok',
        runId: 'run-health-check',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
