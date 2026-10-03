import { createMockRequest, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { GET, PATCH } from '@/app/api/users/me/settings/route'

const mockGetSession = authMockFns.mockGetSession

describe('PATCH /api/users/me/settings', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
  })

  it('does not acknowledge a privacy update when the session has expired', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await PATCH(createMockRequest('PATCH', { telemetryEnabled: false }))

    expect(response.status).toBe(401)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  /**
   * The regression this guards: the catch answered `{ success: true }` with 200, so
   * `useUpdateGeneralSetting`'s optimistic rollback in `onError` could never run —
   * a failed write showed as applied until the next refetch, including for
   * consent-shaped settings the user believes they changed.
   */
  it('reports failure when the write throws', async () => {
    dbChainMockFns.insert.mockImplementationOnce(() => {
      throw new Error('connection terminated unexpectedly')
    })

    const response = await PATCH(createMockRequest('PATCH', { theme: 'dark' }))

    expect(response.status).toBe(500)
    expect(await response.json()).not.toMatchObject({ success: true })
  })
})

describe('GET /api/users/me/settings', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue(null)
  })

  it('preserves anonymous defaults without entering the protected current-user read', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { theme: 'system', autoConnect: true, telemetryEnabled: false },
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('does not replace unavailable saved preferences with permission to collect', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    dbChainMockFns.select.mockImplementationOnce(() => {
      throw new Error('Database unavailable')
    })

    const response = await GET()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to load settings' })
  })
})
