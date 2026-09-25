import {
  apiServerRoutesMock,
  apiServerRoutesMockFns,
} from '@sim/testing/mocks/api-server-routes.mock'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  parse: vi.fn(),
  complete: vi.fn(),
  resume: vi.fn(),
}))
vi.mock('@/lib/api/server', () => ({ parseRequest: m.parse }))
vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)
vi.mock('@/lib/knowledge/application/github-setup', () => ({
  completeGitHubSearchSetup: { execute: m.complete },
  continueGitHubSearchSetup: { execute: m.resume },
}))

import { GET as callback } from '@/app/api/knowledge/github/setup/callback/route'

const { mockInternalSessionAuthenticate } = apiServerRoutesMockFns

const principal = { kind: 'session', userId: 'admin', sessionId: 'browser' }
const setupId = '550e8400-e29b-41d4-a716-446655440000'
const state = '660e8400-e29b-41d4-a716-446655440000'
const completeUrl = `https://sim.example/credential-groups/complete?completionId=${setupId}`

beforeEach(() => {
  mockInternalSessionAuthenticate.mockResolvedValue(principal)
  m.complete.mockResolvedValue({ url: completeUrl })
  m.resume.mockResolvedValue({ url: 'https://github.com/apps/test/installations/new?state=opaque' })
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
