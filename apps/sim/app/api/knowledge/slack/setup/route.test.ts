/** @vitest-environment node */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), start: vi.fn(), connect: vi.fn() }))
vi.mock('@/lib/knowledge/application/slack-search/setup', async () => {
  const { knowledgeOperations } = await import('@/lib/knowledge/application/operations')
  return {
    connectCustomSlackSearch: {
      operation: knowledgeOperations.connectCustomSlackInstallation,
      execute: mocks.connect,
    },
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

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST as start } from '@/app/api/knowledge/slack/oauth/route'
import { POST as connect } from '@/app/api/knowledge/slack/setup/connect/route'
import { POST as prepare } from '@/app/api/knowledge/slack/setup/route'

const input = {
  organizationId: 'organization-1',
  name: 'Sim Search',
  description: 'Search',
  botToken: 'xoxb-existing',
}

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
  ['connect installed app', connect, mocks.connect],
] as const)('Slack %s route errors', (_name, route, execute) => {
  it('returns application validation errors', async () => {
    execute.mockRejectedValue(
      new OrchestrationError('validation', 'Slack app credentials are required')
    )
    const response = await route(createMockRequest('POST', input))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Slack app credentials are required' })
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

it('connects an installed app with the current session and returns no install URL', async () => {
  mocks.connect.mockResolvedValueOnce({ organizationId: input.organizationId })
  const response = await connect(createMockRequest('POST', input))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ organizationId: input.organizationId })
  expect(mocks.connect).toHaveBeenCalledWith(
    expect.objectContaining({
      principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
      input,
    })
  )
  expect(mocks.start).not.toHaveBeenCalled()
})

it.each(['', '   ', undefined])('requires an existing bot token: %s', async (botToken) => {
  const response = await connect(createMockRequest('POST', { ...input, botToken }))
  expect(response.status).toBe(400)
  expect(mocks.connect).not.toHaveBeenCalled()
})
