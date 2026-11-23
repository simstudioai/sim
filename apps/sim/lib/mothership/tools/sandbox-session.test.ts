import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { setEnv } from '@sim/testing/mocks/env.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipWorkerFetchMock,
  mothershipWorkerFetchMockFns,
} from '@sim/testing/mocks/mothership-worker-fetch.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { read, mint, connection, endpoint, workspaceFileCopy, entitlements } = vi.hoisted(() => ({
  connection: vi.fn(),
  entitlements: vi.fn(),
  endpoint: vi.fn(),
  read: vi.fn(),
  mint: vi.fn(),
  workspaceFileCopy: vi.fn(),
}))
vi.mock('@/lib/mothership/transport/connection', () => ({ getSimConnection: connection }))
vi.mock('node:fs/promises', () => ({ readFile: read }))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: mint }))
vi.mock('@/lib/mothership/request/worker/fetch', () => mothershipWorkerFetchMock)
vi.mock('@/lib/mothership/request/headers', () => ({
  mothershipRequestHeaders: () => ({ 'x-api-key': 'worker-test-key' }),
}))
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)
vi.mock('@/lib/mothership/entitlements', () => ({ computeEntitlements: entitlements }))

import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { buildMothershipSandboxSession } from '@/lib/mothership/tools/sandbox-session'

const fetchBootstrap = mothershipWorkerFetchMockFns.mockFetchWorker
const baseURL = mothershipAgentUrlMockFns.mockGetMothershipBaseURL

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://unused.test')
setEnv({ MOTHERSHIP_SANDBOX_CLI_ENDPOINT: 'https://sim.test', ENCRYPTION_KEY: 'a'.repeat(64) })

const principal = createDelegatedPrincipal({
  subjectUserId: 'user',
  workspaceId: 'workspace',
  audience: 'sim:function-executions',
})
const request = { sessionKey: 'chat', workspaceId: 'workspace', userId: 'user', principal }

describe('deployment-owned workbench tooling', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    connection.mockReturnValue({ mode: 'direct' })
    mint.mockResolvedValue('test-delegation')
    entitlements.mockResolvedValue([])
    endpoint.mockImplementation(async (url) => `${url}/api/mothership/sandbox/owned-token`)
    baseURL.mockResolvedValue('https://worker.test')
    fetchBootstrap.mockImplementation(async () =>
      Response.json({ version: 1, entrypoint: 'private-entry' })
    )
  })

  it('keeps private Sim credentials, endpoint and CLI bootstrap out of the sandbox', async () => {
    connection.mockReturnValue({ mode: 'checkpoint', channelId: 'a'.repeat(64) })
    expect(await buildMothershipSandboxSession(request)).toEqual({ key: 'chat' })
    expect(read).not.toHaveBeenCalled()
    expect(fetchBootstrap).not.toHaveBeenCalled()
    expect(mint).not.toHaveBeenCalled()
  })

  it('stages the current deployment bundle and keeps credentials out of installed files', async () => {
    read.mockResolvedValueOnce('bundle-one').mockResolvedValueOnce('bundle-two')
    const first = await buildMothershipSandboxSession(request)
    const second = await buildMothershipSandboxSession(request)
    expect(first.cli).toMatchObject({
      content: 'private-entry',
      path: expect.stringMatching(/^\/home\/user\/\.sim-cli\/[a-f0-9]{64}\/cli\.mjs$/),
      runtime: { content: 'bundle-one', path: expect.stringMatching(/\/runtime\.mjs$/) },
    })
    expect(read).toHaveBeenCalledWith(expect.stringContaining('/dist/runtime.js'), 'utf8')
    expect(baseURL).toHaveBeenCalledWith({ userId: 'user' })
    expect(fetchBootstrap).toHaveBeenCalledWith(
      'https://worker.test/api/workbench/bootstrap',
      expect.objectContaining({
        headers: { 'x-api-key': 'worker-test-key' },
        redirect: 'error',
      })
    )
    expect(second.cli?.path).not.toBe(first.cli?.path)
    expect(JSON.stringify(first.cli)).not.toContain('test-delegation')
    expect(mint).not.toHaveBeenCalled()
    expect(JSON.stringify(first)).not.toContain('test-delegation')
    expect(first.envs?.SIM_API_KEY).not.toBe(second.envs?.SIM_API_KEY)
    expect(first.envs).toEqual({
      SIM_API_KEY: expect.stringMatching(/^mothership-sandbox:[0-9a-f-]{36}$/),
      SIM_WORKSPACE: 'workspace',
      SIM_ENDPOINT: 'https://sim.test/api/mothership/sandbox/owned-token',
    })
  })

  it('tells the workbench an admitted lease copies between workspaces without Projects', async () => {
    read.mockResolvedValue('bundle')
    workspaceFileCopy.mockReturnValue(true)
    const session = await buildMothershipSandboxSession(request)
    expect(session.envs).toMatchObject({ SIM_WORKSPACE_FILE_COPY: '1' })
    expect(session.envs).not.toHaveProperty('SIM_FILE_OWNER_PROTOCOL')
  })

  it('exposes the owner entitlements computed for this execution to the workbench CLI', async () => {
    read.mockResolvedValue('bundle')
    entitlements
      .mockResolvedValueOnce(['dashboards', 'workflow-code'])
      .mockResolvedValueOnce(['dashboards'])
    const first = await buildMothershipSandboxSession(request)
    const second = await buildMothershipSandboxSession(request)
    expect(first.envs).toMatchObject({ SIM_ENTITLEMENTS: 'dashboards,workflow-code' })
    expect(second.envs).toMatchObject({ SIM_ENTITLEMENTS: 'dashboards' })
    expect(entitlements).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          subjectUserId: 'user',
          workspaceId: 'workspace',
          delegationId: principal.delegationId,
          audience: 'sim:workspaces',
        }),
        workspaceId: 'workspace',
      })
    )
  })

  it('scopes organization chat entitlements to the organization', async () => {
    read.mockResolvedValue('bundle')
    entitlements.mockResolvedValue(['workflow-code'])
    const session = await buildMothershipSandboxSession({
      sessionKey: 'chat',
      organizationId: 'org',
      userId: 'user',
      principal: createTrustedOrganizationCopilotPrincipal(
        { userId: 'user', organizationId: 'org', chatId: 'chat', delegationId: 'run' },
        { audience: 'sim:function-executions', ttlMs: 60_000 }
      ),
    })
    expect(session.envs).toMatchObject({
      SIM_ORGANIZATION_ID: 'org',
      SIM_ENTITLEMENTS: 'workflow-code',
    })
    expect(entitlements.mock.calls[0][0]).toMatchObject({
      principal: { organizationId: 'org', delegationId: 'run', audience: 'sim:workspaces' },
      workspaceId: undefined,
    })
  })

  it('omits SIM_ENTITLEMENTS when none are granted or they cannot be read', async () => {
    read.mockResolvedValue('bundle')
    expect((await buildMothershipSandboxSession(request)).envs).not.toHaveProperty(
      'SIM_ENTITLEMENTS'
    )
    entitlements.mockRejectedValueOnce(new Error('flag store down'))
    const degraded = await buildMothershipSandboxSession(request)
    expect(degraded.envs).toMatchObject({ SIM_WORKSPACE: 'workspace' })
    expect(degraded.envs).not.toHaveProperty('SIM_ENTITLEMENTS')
  })

  it('refuses setup when the deployment artifact is missing instead of fetching another CLI release', async () => {
    read.mockRejectedValue(new Error('missing workbench bundle'))
    await expect(buildMothershipSandboxSession(request)).rejects.toThrow('missing workbench bundle')
    expect(mint).not.toHaveBeenCalled()
  })

  it('pins both policy and runtime versions and refuses unavailable or malformed private bootstrap', async () => {
    read.mockResolvedValue('same-public-runtime')
    const first = await buildMothershipSandboxSession(request)
    fetchBootstrap.mockResolvedValueOnce(
      Response.json({ version: 1, entrypoint: 'private-entry-v2' })
    )
    const second = await buildMothershipSandboxSession(request)
    expect(second.cli?.path).not.toBe(first.cli?.path)
    for (const response of [
      new Response('Unavailable', { status: 503 }),
      Response.json({ version: 2, entrypoint: 'unknown' }),
    ]) {
      mint.mockClear()
      fetchBootstrap.mockResolvedValueOnce(response)
      await expect(buildMothershipSandboxSession(request)).rejects.toThrow()
      expect(mint).not.toHaveBeenCalled()
    }
  })

  it.each(['direct', 'checkpoint'])(
    'cancels %s setup before provider or credential work',
    async (mode) => {
      connection.mockReturnValue({ mode, channelId: 'a'.repeat(64) })
      const controller = new AbortController()
      controller.abort(new Error('Stopped'))
      await expect(
        buildMothershipSandboxSession({ ...request, signal: controller.signal })
      ).rejects.toThrow('Stopped')
      expect(read).not.toHaveBeenCalled()
      expect(fetchBootstrap).not.toHaveBeenCalled()
      expect(mint).not.toHaveBeenCalled()
    }
  )
})

vi.mock('@/lib/mothership/tools/sandbox-resources', () => ({
  sandboxResourceEndpoint: endpoint,
  activeSandboxChatOwner: () => undefined,
  activeSandboxFileOwnerProtocol: () => undefined,
  activeSandboxWorkspaceFileCopy: workspaceFileCopy,
}))

it('does not inject authentication when no active scoped callback can be established', async () => {
  connection.mockReturnValue({ mode: 'direct' })
  baseURL.mockResolvedValue('https://worker.test')
  fetchBootstrap.mockResolvedValue(Response.json({ version: 1, entrypoint: 'private-entry' }))
  read.mockResolvedValue('bundle')
  endpoint.mockImplementation(async (url) => url)
  expect((await buildMothershipSandboxSession(request)).envs).toBeUndefined()
  expect(endpoint).toHaveBeenCalledOnce()
  expect(mint).not.toHaveBeenCalled()
})
