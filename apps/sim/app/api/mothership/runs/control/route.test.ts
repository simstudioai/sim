import { authBanMock, authBanMockFns } from '@sim/testing/mocks/auth-ban.mock'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/mothership/request/http')
vi.mock('@/lib/auth/ban', () => authBanMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)

import { env } from '@/lib/core/config/env'
import { POST } from '@/app/api/mothership/runs/control/route'

const mocks = {
  run: mothershipAsyncRunsMockFns.mockGetLatestRunForStream,
  stopped: mothershipAsyncRunsMockFns.mockIsRunStopRequested,
  authorize: workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation,
  banned: authBanMockFns.mockGetActivelyBannedUserIds,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}

const chatId = '33333333-3333-4333-8333-333333333333'
function request(headers: Record<string, string> = {}) {
  return createMockRequest({
    method: 'POST',
    url: 'http://localhost/api/mothership/runs/control',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.INTERNAL_API_SECRET ?? '',
      'x-mothership-user-id': 'actor',
      'x-mothership-workspace-id': 'workspace',
      ...headers,
    },
    body: { chatId, streamId: 'stream' },
  })
}

beforeEach(() => {
  resetDbChainMock()
  queueTableRows(schemaMock.copilotChats, [{ userId: 'actor', workspaceId: 'workspace' }])
  mocks.banned.mockResolvedValue([])
  mocks.workspace.mockResolvedValue({
    workspaceId: 'workspace',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: false,
  })
  mocks.authorize.mockResolvedValue(undefined)
  mocks.run.mockResolvedValue({ chatId, workspaceId: 'workspace' })
  mocks.stopped.mockResolvedValue(true)
})

describe('worker run control boundary', () => {
  it.each([
    ['x-api-key', 'browser-key'],
    ['x-mothership-user-id', ''],
    ['x-mothership-workspace-id', ''],
  ])('rejects invalid service identity: %s', async (header, value) => {
    expect((await POST(request({ [header]: value }))).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('conceals a chat belonging to another actor', async () => {
    expect((await POST(request({ 'x-mothership-user-id': 'other-actor' }))).status).toBe(404)
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it.each([
    null,
    { chatId: 'other-chat', workspaceId: 'workspace' },
    { chatId, workspaceId: 'other-workspace' },
  ])('refuses a missing or mismatched canonical run: %j', async (run) => {
    mocks.run.mockResolvedValue(run)
    expect((await POST(request())).status).toBe(404)
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('does not turn a database outage into permission to continue', async () => {
    mocks.stopped.mockRejectedValue(new Error('database unavailable'))
    expect((await POST(request())).status).toBe(500)
  })
})
