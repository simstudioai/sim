import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { POST } from '@/app/api/desktop/source-connect/route'

describe('POST /api/desktop/source-connect', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } })
  })

  it('rejects a body far beyond the ticket limit at the parser', async () => {
    const body = JSON.stringify({
      requestId: 'a'.repeat(32),
      request: { kind: 'reconnect-account', credentialId: 'c'.repeat(128) },
      padding: 'x'.repeat(256 * 1024),
    })
    const response = await POST(
      new NextRequest('http://localhost/api/desktop/source-connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      {}
    )
    expect(response.status).toBe(413)
  })
})
