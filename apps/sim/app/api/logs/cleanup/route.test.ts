import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, bounded, scheduled } = vi.hoisted(() => ({
  auth: vi.fn(),
  bounded: vi.fn(),
  scheduled: vi.fn(),
}))
vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: auth }))
vi.mock('@/lib/billing/cleanup-dispatcher', () => ({
  dispatchBoundedCleanup: bounded,
  dispatchCleanupJobs: scheduled,
}))

import { GET as softDeletes } from '@/app/api/cron/cleanup-soft-deletes/route'
import { GET as logs } from '@/app/api/logs/cleanup/route'

for (const [path, GET, type, limit] of [
  ['/api/logs/cleanup', logs, 'cleanup-logs', 'workflowLogs'],
  ['/api/cron/cleanup-soft-deletes', softDeletes, 'cleanup-soft-deletes', 'workflows'],
] as const) {
  describe(path, () => {
    beforeEach(() => {
      vi.clearAllMocks()
      auth.mockReturnValue(null)
      bounded.mockResolvedValue({ triggered: true, runId: 'run-one', limits: { [limit]: 2 } })
      scheduled.mockResolvedValue({
        jobIds: ['batch-one'],
        jobCount: 1,
        chunkCount: 2,
        workspaceCount: 3,
      })
    })
    const request = (query = '') =>
      createMockRequest('GET', undefined, {}, `http://localhost:3000${path}${query}`)
    it('authenticates before parsing invalid limits', async () => {
      auth.mockReturnValue(new Response(null, { status: 401 }))
      expect((await GET(request('?unknown=1'))).status).toBe(401)
      expect(bounded).not.toHaveBeenCalled()
      expect(scheduled).not.toHaveBeenCalled()
    })
    it('keeps no-parameter scheduled dispatch unchanged', async () => {
      const response = await GET(request())
      expect(response.status).toBe(200)
      expect(scheduled).toHaveBeenCalledWith(type)
      expect(bounded).not.toHaveBeenCalled()
    })
    it('accepts one bounded run', async () => {
      const response = await GET(request(`?${limit}=2`))
      expect(response.status).toBe(202)
      expect(bounded).toHaveBeenCalledWith(type, { [limit]: 2 })
      expect(await response.json()).toEqual({
        triggered: true,
        runId: 'run-one',
        limits: { [limit]: 2 },
      })
      expect(scheduled).not.toHaveBeenCalled()
    })
    it.each(['?dryRun=true', '?unknown=1', '?batchSize=3', `?${limit}=2&${limit}=3`])(
      'rejects invalid query %s',
      async (query) => {
        expect((await GET(request(query))).status).toBe(400)
        expect(bounded).not.toHaveBeenCalled()
        expect(scheduled).not.toHaveBeenCalled()
      }
    )
    it('reports a dispatch failure', async () => {
      bounded.mockRejectedValue(new Error('Trigger unavailable'))
      expect((await GET(request(`?${limit}=2`))).status).toBe(500)
    })
  })
}
