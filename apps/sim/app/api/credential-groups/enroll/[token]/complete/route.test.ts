/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCompleteEnrollment, mockIpRateLimit } = vi.hoisted(() => ({
  mockCompleteEnrollment: vi.fn(),
  mockIpRateLimit: vi.fn(),
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  completeCredentialGroupEnrollment: mockCompleteEnrollment,
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mockIpRateLimit,
}))

import { POST } from '@/app/api/credential-groups/enroll/[token]/complete/route'

const context = { params: Promise.resolve({ token: 'invitation-token' }) }

function request() {
  return new NextRequest(
    'http://localhost:3000/api/credential-groups/enroll/invitation-token/complete',
    { method: 'POST' }
  )
}

describe('credential group enrollment completion route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIpRateLimit.mockResolvedValue(null)
    mockCompleteEnrollment.mockResolvedValue(true)
  })

  it('submits a fully connected enrollment and redirects to its checklist', async () => {
    const response = await POST(request(), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?submitted=1'
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mockCompleteEnrollment).toHaveBeenCalledWith('invitation-token')
  })

  it('redirects an incomplete enrollment without marking it complete', async () => {
    mockCompleteEnrollment.mockResolvedValue(false)

    const response = await POST(request(), context)

    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=incomplete'
    )
  })

  it('stops before token lookup when the public IP budget is exhausted', async () => {
    mockIpRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )

    const response = await POST(request(), context)

    expect(response.status).toBe(429)
    expect(mockCompleteEnrollment).not.toHaveBeenCalled()
  })
})
