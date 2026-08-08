/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getPersistedResponse: vi.fn(),
  readEvents: vi.fn(),
  updateRunStatus: vi.fn(),
  recordAudit: vi.fn(),
  envFlags: { isAuthDisabled: false },
}))

vi.mock('@/lib/core/config/env-flags', () => mocks.envFlags)

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/copilot/chat/public-runs', () => ({
  listPublicChatRuns: mocks.listRuns,
  getPublicChatRun: mocks.getRun,
  getPersistedPublicChatRunResponse: mocks.getPersistedResponse,
}))

vi.mock('@/lib/copilot/request/session', () => ({
  readEvents: mocks.readEvents,
  eventToStreamEvent: (event: { type: string; payload: unknown; scope?: unknown }) => ({
    type: event.type,
    payload: event.payload,
    ...(event.scope ? { scope: event.scope } : {}),
  }),
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  updateRunStatus: mocks.updateRunStatus,
}))

vi.mock('@/lib/copilot/headless/workspace-chat', () => ({
  publicChatUsageLimitMessage: (content: string) =>
    /^\s*<usage_upgrade>[\s\S]+<\/usage_upgrade>\s*$/.test(content) ? 'Usage limit exceeded' : null,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { ChatRunProgressUnavailableError } from '@/lib/copilot/chat/application/errors'
import { chatOperations } from '@/lib/copilot/chat/application/operations'
import { listChatRuns, readChatRun } from '@/lib/copilot/chat/application/runs'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const personalPrincipal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}
const run = {
  runId: '4bfa6f89-b746-43be-8246-bf1c69b58593',
  chatId: '80a47295-040e-46f9-9ea8-ad78eff3bcab',
  chatTitle: 'Release plan',
  streamId: 'stream-1',
  status: 'complete' as const,
  startedAt: new Date('2026-08-08T12:00:00.000Z'),
  completedAt: new Date('2026-08-08T12:01:00.000Z'),
}

function envelope(seq: number, type: string, payload: Record<string, unknown>) {
  return {
    v: 1,
    seq,
    ts: `2026-08-08T12:00:0${seq}.000Z`,
    stream: { streamId: 'stream-1' },
    type,
    payload,
  }
}

describe('chat run application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.envFlags.isAuthDisabled = false
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.listRuns.mockResolvedValue({ status: 'ok', rows: [] })
    mocks.getRun.mockResolvedValue(run)
    mocks.getPersistedResponse.mockResolvedValue(null)
    mocks.readEvents.mockResolvedValue([
      envelope(1, 'session', { kind: 'chat', chatId: run.chatId }),
      envelope(2, 'text', { channel: 'assistant', text: 'Done' }),
      envelope(3, 'complete', { status: 'complete' }),
    ])
    mocks.updateRunStatus.mockResolvedValue(null)
  })

  it('defines read-only personal-key operations', () => {
    for (const operation of [chatOperations.listRuns, chatOperations.readRun]) {
      expect(operation).toMatchObject({
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['personal_api_key'],
      })
    }
  })

  it('rejects workspace keys before canonical workspace or run loading', async () => {
    await expect(
      readChatRun.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'key-1',
        },
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.getRun).not.toHaveBeenCalled()
  })

  it('enforces personal-key workspace policy before protected run reads', async () => {
    mocks.loadWorkspace.mockResolvedValue({ ...workspaceContext, allowPersonalApiKeys: false })

    await expect(
      listChatRuns.execute({
        principal: personalPrincipal,
        input: { workspaceId: 'workspace-1', limit: 30 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.listRuns).not.toHaveBeenCalled()
    expect(mocks.getRun).not.toHaveBeenCalled()
  })

  it('does not treat the auth-disabled self-host principal as a real personal key', async () => {
    mocks.envFlags.isAuthDisabled = true
    mocks.loadWorkspace.mockResolvedValue({ ...workspaceContext, allowPersonalApiKeys: false })

    await listChatRuns.execute({
      principal: { ...personalPrincipal, keyId: 'auth-disabled' },
      input: { workspaceId: 'workspace-1', limit: 30 },
    })

    expect(mocks.resolvePermission).toHaveBeenCalled()
    expect(mocks.listRuns).toHaveBeenCalled()
  })

  it('requires current personal-key permission before protected run reads', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      listChatRuns.execute({
        principal: personalPrincipal,
        input: { workspaceId: 'workspace-1', limit: 30 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.listRuns).not.toHaveBeenCalled()
    expect(mocks.getRun).not.toHaveBeenCalled()
  })

  it('authorizes the personal key before listing its owned runs', async () => {
    mocks.listRuns.mockResolvedValue({ status: 'ok', rows: [run, { ...run }] })

    const result = await listChatRuns.execute({
      principal: personalPrincipal,
      input: { workspaceId: 'workspace-1', status: 'complete', limit: 1 },
    })

    expect(mocks.resolvePermission).toHaveBeenCalled()
    expect(mocks.listRuns).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      status: 'complete',
      limit: 1,
      cursorKeys: undefined,
    })
    expect(result).toEqual({ rows: [run], hasMore: true })
  })

  it('keeps malformed keyset cursors out of successful application results', async () => {
    mocks.listRuns.mockResolvedValue({ status: 'invalid_cursor' })

    await expect(
      listChatRuns.execute({
        principal: personalPrincipal,
        input: { workspaceId: 'workspace-1', limit: 30, cursorKeys: ['bad'] },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('masks every scoped run miss as chat-run absence', async () => {
    mocks.getRun.mockResolvedValue(null)

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Chat run not found' })
  })

  it('returns safe accumulated text and repairs stale terminal status from replay', async () => {
    mocks.getRun.mockResolvedValue({ ...run, status: 'active', completedAt: null })

    const result = await readChatRun.execute({
      principal: personalPrincipal,
      input: { runId: run.runId, workspaceId: 'workspace-1' },
    })

    expect(result).toMatchObject({
      status: 'complete',
      completedAt: new Date('2026-08-08T12:00:03.000Z'),
      response: 'Done',
      activities: [],
    })
    expect(mocks.updateRunStatus).toHaveBeenCalledWith(run.runId, 'complete', {
      completedAt: new Date('2026-08-08T12:00:03.000Z'),
    })
  })

  it('projects replay into safe root text and opaque activities', async () => {
    mocks.readEvents.mockResolvedValue([
      envelope(1, 'session', { kind: 'chat', chatId: run.chatId }),
      envelope(2, 'text', { channel: 'assistant', text: 'Done' }),
      envelope(3, 'text', { channel: 'thinking', text: 'private chain of thought' }),
      envelope(4, 'tool', {
        toolCallId: 'private-tool-id',
        toolName: 'read',
        phase: 'call',
        arguments: { path: 'files/private.txt', secret: 'private-argument' },
        executor: 'go',
        mode: 'sync',
      }),
      envelope(5, 'tool', {
        toolCallId: 'private-tool-id',
        toolName: 'read',
        phase: 'result',
        status: 'success',
        success: true,
        output: { secret: 'private-result' },
      }),
      envelope(6, 'error', { code: 'PRIVATE', message: 'private-error' }),
      envelope(7, 'complete', { status: 'complete', reason: 'private-reason' }),
    ])

    const result = await readChatRun.execute({
      principal: personalPrincipal,
      input: { runId: run.runId, workspaceId: 'workspace-1' },
    })
    const progress = { response: result.response, activities: result.activities }
    const serialized = JSON.stringify(progress)

    expect(progress).toEqual({
      response: 'Done',
      activities: [
        { kind: 'tool', id: 'tool-1', label: 'Reading private.txt', state: 'running' },
        { kind: 'tool', id: 'tool-1', label: 'Read private.txt', state: 'complete' },
      ],
    })
    for (const privateValue of [
      'private-tool-id',
      'files/private.txt',
      'private-argument',
      'private-result',
      'private-error',
      'private-reason',
      'private chain of thought',
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  it('uses persisted assistant prose after a terminal replay expires', async () => {
    mocks.readEvents.mockResolvedValue([])
    mocks.getPersistedResponse.mockResolvedValue('Stored answer')

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({ response: 'Stored answer', activities: [] })
  })

  it('uses persisted assistant prose when terminal replay has no root text', async () => {
    mocks.getPersistedResponse.mockResolvedValue('Stored answer')
    mocks.readEvents.mockResolvedValue([
      envelope(1, 'session', { kind: 'chat', chatId: run.chatId }),
      envelope(2, 'complete', { status: 'complete' }),
    ])

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({ response: 'Stored answer' })
  })

  it('falls back to persisted text when terminal replay has a sequence gap', async () => {
    mocks.getPersistedResponse.mockResolvedValue('Complete stored answer')
    mocks.readEvents.mockResolvedValue([
      envelope(1, 'text', { channel: 'assistant', text: 'Truncated ' }),
      envelope(3, 'complete', { status: 'complete' }),
    ])

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({
      status: 'complete',
      response: 'Complete stored answer',
      activities: [],
    })
  })

  it('uses replay completion metadata when stale durable terminal state disagrees', async () => {
    mocks.getRun.mockResolvedValue({
      ...run,
      status: 'error',
      completedAt: new Date('2026-08-08T11:59:00.000Z'),
    })

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({
      status: 'complete',
      completedAt: new Date('2026-08-08T12:00:03.000Z'),
      response: 'Done',
    })
    expect(mocks.updateRunStatus).toHaveBeenCalledWith(run.runId, 'complete', {
      completedAt: new Date('2026-08-08T12:00:03.000Z'),
    })
  })

  it('reports missing or gapped active replay as transient', async () => {
    mocks.getRun.mockResolvedValue({ ...run, status: 'active', completedAt: null })
    mocks.readEvents.mockResolvedValue([])

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toBeInstanceOf(ChatRunProgressUnavailableError)
  })

  it('does not regress an active run when its replay is gapped', async () => {
    mocks.getRun.mockResolvedValue({ ...run, status: 'active', completedAt: null })
    mocks.readEvents.mockResolvedValue([
      envelope(1, 'text', { channel: 'assistant', text: 'Partial' }),
      envelope(3, 'text', { channel: 'assistant', text: ' answer' }),
    ])

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toBeInstanceOf(ChatRunProgressUnavailableError)
    expect(mocks.getPersistedResponse).not.toHaveBeenCalled()
  })

  it('reports replay-store failures as transient only while a run is active', async () => {
    mocks.getRun.mockResolvedValue({ ...run, status: 'active', completedAt: null })
    mocks.readEvents.mockRejectedValue(new Error('redis unavailable'))

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toBeInstanceOf(ChatRunProgressUnavailableError)
    expect(mocks.getPersistedResponse).not.toHaveBeenCalled()
  })

  it('propagates unexpected run-store failures unchanged', async () => {
    const failure = new Error('database unavailable')
    mocks.getRun.mockRejectedValueOnce(failure)

    await expect(
      readChatRun.execute({
        principal: personalPrincipal,
        input: { runId: run.runId, workspaceId: 'workspace-1' },
      })
    ).rejects.toBe(failure)
  })
})
