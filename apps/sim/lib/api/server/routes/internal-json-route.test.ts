/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockVerifyInternalToken } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockVerifyInternalToken: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal', () => ({ verifyInternalToken: mockVerifyInternalToken }))

import {
  InternalUnauthenticatedError,
  internalSessionOrServiceAuth,
} from '@/lib/api/server/routes/internal-json-route'

describe('internal file route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
  })

  it('binds a verified internal user to an executor file principal', async () => {
    mockVerifyInternalToken.mockResolvedValue({ valid: true, userId: 'user-1' })

    const principal = await internalSessionOrServiceAuth.authenticate(
      new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
        headers: { authorization: 'Bearer signed-token' },
      }),
      { id: 'ws-1', fileId: 'file-1' }
    )

    expect(principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'ws-1',
      audience: 'sim:workspace-files',
      resourceScope: { fileId: 'file-1' },
    })
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('rejects internal tokens that do not carry a human subject', async () => {
    mockVerifyInternalToken.mockResolvedValue({ valid: true })

    await expect(
      internalSessionOrServiceAuth.authenticate(
        new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
          headers: { authorization: 'Bearer signed-token' },
        }),
        { id: 'ws-1', fileId: 'file-1' }
      )
    ).rejects.toBeInstanceOf(InternalUnauthenticatedError)
  })

  it('preserves browser session principals when no service token is supplied', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })

    await expect(
      internalSessionOrServiceAuth.authenticate(
        new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1'),
        { id: 'ws-1', fileId: 'file-1' }
      )
    ).resolves.toEqual({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
  })
})
