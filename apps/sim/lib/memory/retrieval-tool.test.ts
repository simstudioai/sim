/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ principal: vi.fn(), retrieve: vi.fn() }))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.principal,
}))
vi.mock('@/lib/memory/application/retrieval', () => ({
  retrieveAgentMemoryUseCase: { execute: mocks.retrieve },
}))
vi.mock('@/lib/memory/artifacts', () => ({
  MAX_MEMORY_ARTIFACT_BYTES: 8 * 1024 * 1024,
  readMemoryArtifactByHandle: vi.fn(),
}))
vi.mock('@/lib/memory/conversation-store', () => ({ readConversationItems: vi.fn() }))
vi.mock('@/lib/memory/retrieval-prefix', () => ({ readMemoryRetrievalPrefix: vi.fn() }))

import { createAgentMemoryRetrievalTool } from '@/lib/memory/retrieval-tool'

describe('trusted Agent memory tool binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.principal.mockResolvedValue({ kind: 'delegated', workspaceId: 'workspace-1' })
    mocks.retrieve.mockResolvedValue({
      source: 'history',
      text: 'safe history',
      scannedItems: 1,
      notice: 'untrusted',
    })
  })

  it('uses the server execution identity and original memory owner for every call', async () => {
    const executionContext = { ...createExecutionContext(), workspaceId: 'workspace-1' }
    const binding = createAgentMemoryRetrievalTool({
      executionContext,
      memoryId: 'memory-original',
    })
    await binding.execute({
      target: 'history',
      _context: { workspaceId: 'forged' },
      _toolSchema: {},
    })
    await binding.execute({ target: 'history' })
    expect(mocks.principal).toHaveBeenCalledTimes(2)
    expect(mocks.principal).toHaveBeenLastCalledWith({
      context: executionContext,
      audience: 'sim:memory',
    })
    expect(mocks.retrieve).toHaveBeenCalledWith({
      principal: { kind: 'delegated', workspaceId: 'workspace-1' },
      input: {
        workspaceId: 'workspace-1',
        memoryId: 'memory-original',
        arguments: { target: 'history' },
        projection: executionContext,
      },
    })
  })

  it('rejects forged model scope and object-store keys before authentication or retrieval', async () => {
    const binding = createAgentMemoryRetrievalTool({
      executionContext: { ...createExecutionContext(), workspaceId: 'workspace-1' },
      memoryId: 'memory-original',
    })
    for (const params of [
      { target: 'history', memoryId: 'foreign-memory' },
      { target: 'history', workspaceId: 'foreign-workspace' },
      { target: 'artifact', artifactId: 'execution/foreign/object.json' },
    ])
      expect(await binding.execute(params)).toMatchObject({ success: false })
    expect(mocks.principal).not.toHaveBeenCalled()
    expect(mocks.retrieve).not.toHaveBeenCalled()
  })

  it('conceals credential-binding, authorization, storage and PII infrastructure failures', async () => {
    const binding = createAgentMemoryRetrievalTool({
      executionContext: { ...createExecutionContext(), workspaceId: 'workspace-1' },
      memoryId: 'memory-original',
    })
    mocks.principal.mockRejectedValueOnce(new Error('private authentication canary'))
    expect(JSON.stringify(await binding.execute({ target: 'history' }))).not.toContain('canary')
    mocks.retrieve.mockRejectedValueOnce(new Error('private database canary'))
    expect(await binding.execute({ target: 'history' })).toEqual({
      success: false,
      output: {},
      error: 'Memory content unavailable for safe retrieval',
    })
  })

  it('aborts before reading any retained data', async () => {
    const executionContext = {
      ...createExecutionContext({ abortSignal: AbortSignal.abort() }),
      workspaceId: 'workspace-1',
    }
    const binding = createAgentMemoryRetrievalTool({
      executionContext,
      memoryId: 'memory-original',
    })
    await expect(binding.execute({ target: 'history' })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.retrieve).not.toHaveBeenCalled()
  })

  it('caps artifact materialization concurrency across bindings in one execution and releases on failure', async () => {
    const executionContext = { ...createExecutionContext(), workspaceId: 'workspace-1' }
    const first = createAgentMemoryRetrievalTool({ executionContext, memoryId: 'first-memory' })
    const second = createAgentMemoryRetrievalTool({ executionContext, memoryId: 'second-memory' })
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const failAfterRelease = async () => {
      await pending
      throw new Error('read failed')
    }
    mocks.retrieve.mockImplementationOnce(failAfterRelease).mockImplementationOnce(failAfterRelease)
    const activeFirst = first.execute({ target: 'history' })
    const activeSecond = second.execute({ target: 'history' })
    expect(await first.execute({ target: 'history' })).toMatchObject({
      success: false,
      error: 'Memory read concurrency limit reached. Retry after the current reads complete.',
    })
    release?.()
    await Promise.all([activeFirst, activeSecond])
    expect(await second.execute({ target: 'history' })).toMatchObject({ success: true })
    expect(mocks.retrieve).toHaveBeenCalledTimes(3)
  })
})
