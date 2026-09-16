/** @vitest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  authenticate: vi.fn(),
  parse: vi.fn(),
  limit: vi.fn(),
  complete: vi.fn(),
  resume: vi.fn(),
}))
vi.mock('@/lib/api/server', () => ({ parseRequest: m.parse }))
vi.mock('@/lib/api/server/routes', () => ({
  internalSessionAuth: { authenticate: m.authenticate },
  internalRateLimits: { user: () => ({ enforce: m.limit }) },
  InternalUnauthenticatedError: class extends Error {},
}))
vi.mock('@/lib/knowledge/application/github-setup', () => ({
  completeGitHubSearchSetup: { execute: m.complete },
  continueGitHubSearchSetup: { execute: m.resume },
}))

import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { GET as callback } from '@/app/api/knowledge/github/setup/callback/route'
import { GET as resume } from '@/app/api/knowledge/github/setup/continue/route'

const principal = { kind: 'session', userId: 'admin', sessionId: 'browser' }
const setupId = '550e8400-e29b-41d4-a716-446655440000'
const state = '660e8400-e29b-41d4-a716-446655440000'
const completeUrl = `https://sim.example/credential-groups/complete?completionId=${setupId}`

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticate.mockResolvedValue(principal)
  m.limit.mockResolvedValue(null)
  m.complete.mockResolvedValue({ url: completeUrl })
  m.resume.mockResolvedValue({ url: 'https://github.com/apps/test/installations/new?state=opaque' })
})

describe.each([
  { name: 'callback', handler: callback },
  { name: 'continue', handler: resume },
])('GitHub setup $name ingress', ({ name, handler }) => {
  const request = () => new NextRequest(`https://sim.example/api/knowledge/github/setup/${name}`)
  it('rejects unauthenticated callers before parsing untrusted query fields', async () => {
    m.authenticate.mockRejectedValueOnce(new InternalUnauthenticatedError())
    const response = await handler(request())
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(m.parse).not.toHaveBeenCalled()
    expect(m.complete).not.toHaveBeenCalled()
    expect(m.resume).not.toHaveBeenCalled()
  })
  it('applies rate admission before parsing', async () => {
    m.limit.mockResolvedValueOnce(NextResponse.json({ error: 'Rate limited' }, { status: 429 }))
    expect((await handler(request())).status).toBe(429)
    expect(m.parse).not.toHaveBeenCalled()
  })
  it('does not enter protected work after a malformed query', async () => {
    m.parse.mockResolvedValueOnce({
      success: false,
      response: NextResponse.json({ error: 'Invalid query' }, { status: 400 }),
    })
    expect((await handler(request())).status).toBe(400)
    expect(m.complete).not.toHaveBeenCalled()
    expect(m.resume).not.toHaveBeenCalled()
  })
})

it('passes untrusted callback values to the authorized use case and redirects only to its result', async () => {
  m.parse.mockResolvedValueOnce({
    success: true,
    data: { query: { state, installation_id: '42', setup_action: 'install' } },
  })
  const response = await callback(
    new NextRequest('https://sim.example/api/knowledge/github/setup/callback')
  )
  expect(m.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      principal,
      input: { state, installationId: '42', setupAction: 'install' },
    })
  )
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe(completeUrl)
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
})

it('keeps continuation scope and OAuth failure classification in the application input', async () => {
  const query = { organizationId: 'org', setupId, oauth: 'denied' }
  m.parse.mockResolvedValueOnce({ success: true, data: { query } })
  await resume(new NextRequest('https://sim.example/api/knowledge/github/setup/continue'))
  expect(m.resume).toHaveBeenCalledWith(expect.objectContaining({ principal, input: query }))
})
