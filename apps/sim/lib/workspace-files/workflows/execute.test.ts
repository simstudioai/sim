import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  readRun: vi.fn(),
  readResult: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  cache: vi.fn(),
  available: vi.fn(),
  reconcile: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@/lib/workflows/executor/execute-service', () => ({
  executeWorkflowService: mocks.execute,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))
vi.mock('@/lib/workspace-files/workflows/run-store', () => ({
  readFileWorkflowRun: mocks.readRun,
  readFileWorkflowResult: mocks.readResult,
  claimFileWorkflowRun: mocks.claim,
  finishFileWorkflowRun: mocks.finish,
  cacheFileWorkflowResult: mocks.cache,
  assertFileWorkflowCacheAvailable: mocks.available,
  reconcileFileWorkflowRun: mocks.reconcile,
}))

import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { accessFileWorkflow } from '@/lib/workspace-files/workflows/execute'

const workflow = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  workflow: { id: 'workflow-1', workspaceId: 'workspace-1', isDeployed: true },
} as ActiveWorkflowApplicationContext

function input() {
  return {
    fileId: 'file-1',
    workflow,
    audience: 'audience-1',
    userId: 'user-1',
    run: true,
    principal: { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' },
    publicAccess: false,
    reauthorize: vi.fn().mockResolvedValue(undefined),
  }
}
function run(status = 'completed', audience = 'audience-1') {
  return {
    fileId: 'file-1',
    workflowId: 'workflow-1',
    executionId: 'run-1',
    audience,
    status,
    startedAt: new Date(),
    finishedAt: null,
    deploymentVersionId: null,
  }
}

describe('file workflow execution', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.readRun.mockResolvedValue(null)
    mocks.readResult.mockResolvedValue(null)
    mocks.claim.mockImplementation(async () => run('running'))
    mocks.execute.mockResolvedValue({
      ok: true,
      status: 'completed',
      deploymentVersionId: 'latest-at-start',
      output: { count: 7 },
    })
  })

  it('reads status without reconciling or admitting a run', async () => {
    const args = { ...input(), run: false }
    expect(await accessFileWorkflow(args)).toMatchObject({ status: 'empty', output: null })
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(args.reauthorize).toHaveBeenCalledOnce()
  })

  it('preserves the durable cooldown after cache eviction', async () => {
    mocks.readRun.mockResolvedValue(run())
    expect(await accessFileWorkflow(input())).toMatchObject({ status: 'empty', output: null })
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('does not read another audience’s cache or reveal its execution ID', async () => {
    mocks.readRun.mockResolvedValue(run('completed', 'someone-else'))
    expect(await accessFileWorkflow(input())).toMatchObject({
      status: 'empty',
      executionId: null,
      output: null,
    })
    expect(mocks.readResult).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('uses the deployment chosen by the executor, preserving the acting principal', async () => {
    const args = input()
    const result = await accessFileWorkflow(args)
    expect(result).toMatchObject({
      status: 'completed',
      output: { count: 7 },
      deploymentVersionId: 'latest-at-start',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: args.principal,
        input: {},
        mode: 'sync',
        useAuthenticatedUserAsActor: true,
      })
    )
    expect(mocks.execute.mock.calls[0][0]).not.toHaveProperty('deploymentVersionId')
    expect(mocks.cache).toHaveBeenCalledWith(args.audience, result)
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), result)
    expect(mocks.notify).toHaveBeenCalledWith('workspace-1')
  })

  it('does not execute if another request wins admission', async () => {
    mocks.claim.mockResolvedValue(null)
    mocks.readRun.mockResolvedValueOnce(null).mockResolvedValue(run('running'))
    expect(await accessFileWorkflow(input())).toMatchObject({ status: 'running' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('fails before admission if Redis is unavailable', async () => {
    mocks.available.mockRejectedValue(new Error('Redis unavailable'))
    await expect(accessFileWorkflow(input())).rejects.toThrow('Redis unavailable')
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('rechecks access after admission before invoking the workflow', async () => {
    const args = input()
    args.reauthorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Revoked'))
    await expect(accessFileWorkflow(args)).rejects.toThrow('Revoked')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' })
    )
  })

  it('withholds completed output when access is revoked during execution', async () => {
    const args = input()
    args.reauthorize
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Revoked'))
    await expect(accessFileWorkflow(args)).rejects.toThrow('Revoked')
    expect(mocks.cache).not.toHaveBeenCalled()
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed', output: null })
    )
  })

  it.each(['paused', 'ambiguous'])(
    'does not release the running gate for a %s execution',
    async (status) => {
      if (status === 'paused') mocks.execute.mockResolvedValue({ ok: true, status: 'paused' })
      else mocks.execute.mockRejectedValue(new Error('Transport lost'))
      const promise = accessFileWorkflow(input())
      if (status === 'paused')
        expect(await promise).toMatchObject({ status: 'running', output: null })
      else await expect(promise).rejects.toThrow('Transport lost')
      expect(mocks.finish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'running' })
      )
    }
  )
})
