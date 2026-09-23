/** @vitest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  rateLimit: vi.fn(),
}))
vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  authenticateCredentialGroupEnrollment: mocks.authenticate,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mocks.rateLimit,
  RateLimiter: class {},
}))
vi.mock('@/lib/credential-groups/application/public-enrollment', async () => {
  const { credentialGroupEnrollmentOperations } = await import(
    '@/lib/credential-groups/application/enrollment-operations'
  )
  return {
    savePublicCredentialGroupApiKey: {
      operation: credentialGroupEnrollmentOperations.saveApiKey,
      execute: mocks.save,
    },
    deletePublicCredentialGroupApiKey: {
      operation: credentialGroupEnrollmentOperations.deleteApiKey,
      execute: mocks.remove,
    },
  }
})

import { CredentialGroupEnrollmentError } from '@/lib/credential-groups/enrollments'
import { DELETE, PUT } from '@/app/api/credential-groups/enroll/[token]/api-keys/[optionId]/route'

const optionId = '00000000-0000-4000-8000-000000000001'
const params = { params: Promise.resolve({ token: 'invite-token', optionId }) }
const principal = {
  kind: 'credential_group_enrollment',
  userId: 'person-1',
  organizationId: 'org-1',
  enrollmentId: 'enrollment-1',
  credentialGroupId: 'group-1',
  email: 'person@example.com',
  invitationTokenHash: 'hash',
}
function request(body: string, method = 'PUT') {
  return new NextRequest(
    `http://localhost/api/credential-groups/enroll/invite-token/api-keys/${optionId}`,
    {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'PUT' ? { body } : {}),
    }
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authenticate.mockResolvedValue(principal)
  mocks.save.mockResolvedValue({ connected: true })
  mocks.remove.mockResolvedValue({ connected: false })
  mocks.rateLimit.mockResolvedValue(null)
})
it('authenticates before parsing the submitted key', async () => {
  mocks.authenticate.mockResolvedValue(null)
  const response = await PUT(request('not-json'), params)
  expect(response.status).toBe(401)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.rateLimit).not.toHaveBeenCalled()
})
it('rate-limits the verified contributor before parsing', async () => {
  mocks.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Rate limited' }, { status: 429 }))
  expect((await PUT(request('not-json'), params)).status).toBe(429)
  expect(mocks.rateLimit).toHaveBeenCalledWith(
    'credential-group-api-key',
    'person-1',
    expect.anything()
  )
  expect(mocks.save).not.toHaveBeenCalled()
})
it('returns only connection status and disables caching', async () => {
  const response = await PUT(request(JSON.stringify({ value: 'fixture-secret' })), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ connected: true })
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.save).toHaveBeenCalledWith({
    principal,
    input: { optionId, value: 'fixture-secret' },
    request: expect.any(NextRequest),
  })
})
it.each([
  { value: 'short' },
  { value: 'fixture-secret', userId: 'other-person' },
  { value: 'fixture-secret', unredacted: true },
])('rejects invalid values and ownership overrides %j', async (body) => {
  expect((await PUT(request(JSON.stringify(body)), params)).status).toBe(400)
  expect(mocks.save).not.toHaveBeenCalled()
})
it('projects an invitation identity mismatch without exposing the submitted value', async () => {
  mocks.save.mockRejectedValue(
    new CredentialGroupEnrollmentError('Sign in with the invited email', 400)
  )
  const response = await PUT(request(JSON.stringify({ value: 'fixture-secret' })), params)
  expect(response.status).toBe(400)
  expect(await response.text()).not.toContain('fixture-secret')
})
it('disconnects only through the authenticated enrollment use case', async () => {
  const response = await DELETE(request('', 'DELETE'), params)
  expect(await response.json()).toEqual({ connected: false })
  expect(mocks.remove).toHaveBeenCalledWith({
    principal,
    input: { optionId },
    request: expect.any(NextRequest),
  })
})
