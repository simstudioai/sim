/** @vitest-environment node */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), start: vi.fn() }))
vi.mock('@/lib/knowledge/application/slack-search/setup', async () => {
  const { knowledgeOperations } = await import('@/lib/knowledge/application/operations')
  return {
    prepareSlackSearchSetup: {
      operation: knowledgeOperations.prepareSlackInstallation,
      execute: mocks.prepare,
    },
    startSlackSearchSetup: {
      operation: knowledgeOperations.startSlackInstallation,
      execute: mocks.start,
    },
  }
})

import { createSlackSearchManifest } from '@/lib/slack-search/manifest'
import { POST as start } from '@/app/api/knowledge/slack/oauth/route'
import { POST as prepare } from '@/app/api/knowledge/slack/setup/route'

const input = { organizationId: 'organization-1', name: 'Sim Search', description: 'Search' }

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'admin' },
    session: { id: 'session' },
  })
})

describe.each([
  ['prepare', prepare, mocks.prepare],
  ['OAuth', start, mocks.start],
] as const)('Slack %s route errors', (_name, route, execute) => {
  it('returns an actionable 400 for a non-HTTPS app URL', async () => {
    execute.mockImplementation(() =>
      createSlackSearchManifest(input.name, input.description, 'http://localhost:3000')
    )
    const response = await route(createMockRequest('POST', input))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('public HTTPS') })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('still conceals unexpected errors', async () => {
    execute.mockRejectedValue(new Error('private database configuration'))
    const response = await route(createMockRequest('POST', input))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Internal server error' })
  })

  it('authenticates before exposing setup configuration', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await route(createMockRequest('POST', {}))
    expect(response.status).toBe(401)
    expect(execute).not.toHaveBeenCalled()
  })
})
