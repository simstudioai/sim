import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
}))

import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import {
  createIncompleteResolvedSecretTraceRegistry,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

function refusalRecords() {
  return mockLogger.error.mock.calls.filter(
    ([message]) => message === 'Resolved secret projection refused'
  )
}

describe('refuseResolvedSecretProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws the call site message unchanged so the user-facing wording never drifts', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    registry.markIncomplete('projection-mismatch')

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'router.promptModelInput',
        message: 'Router model input could not be safely projected',
        registry,
      })
    ).toThrow('Router model input could not be safely projected')
  })

  it('uses the call site error type when one is needed for control flow', () => {
    class ToolInputSafetyError extends Error {}
    const registry = new ResolvedSecretTraceRegistry([], scope)
    registry.markIncomplete('projection-mismatch')

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'agent.toolInput',
        message: 'Agent tool input could not be safely projected',
        registry,
        createError: (message) => new ToolInputSafetyError(message),
      })
    ).toThrow(ToolInputSafetyError)
  })

  it('reports the guard that caused the refusal, not merely that one occurred', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    registry.markIncomplete('projection-mismatch')

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'router.promptModelInput',
        message: 'Router model input could not be safely projected',
        registry,
        inputPath: 'prompt',
      })
    ).toThrow()

    expect(refusalRecords()).toHaveLength(1)
    expect(refusalRecords()[0][1]).toEqual(
      expect.objectContaining({
        site: 'router.promptModelInput',
        inputPath: 'prompt',
        reason: 'projection-mismatch',
        scopeWorkspaceId: 'workspace-1',
      })
    )
  })

  /**
   * The reason says what tripped; without the location a reader still has to go hunting for which
   * block. Nested rather than flattened because the guard's own `inputPath` and the refusal's name
   * different places once a latch has travelled.
   */
  it('reports where the first guard tripped, not only what it was', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    registry.markIncomplete('structural-input-root-unprojected', {
      detail: { blockType: 'table', tool: 'table_insert_row', inputPath: 'data' },
    })

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'agent.toolCallCrossing',
        message: 'Tool call could not be safely projected',
        registry,
        inputPath: 'messages',
      })
    ).toThrow()

    expect(refusalRecords()[0][1]).toEqual(
      expect.objectContaining({
        inputPath: 'messages',
        detail: { blockType: 'table', tool: 'table_insert_row', inputPath: 'data' },
      })
    )
  })

  it('names a by-design origin that was silenced when it was marked', () => {
    const registry = createIncompleteResolvedSecretTraceRegistry(scope)
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'agent.coreModelInput',
        message: 'Agent model input could not be safely projected',
        registry,
      })
    ).toThrow()

    expect(refusalRecords()[0][1]).toEqual(
      expect.objectContaining({ reason: 'constructed-incomplete' })
    )
  })

  it('reports the originating guard through a fork that only inherited it', () => {
    const parent = new ResolvedSecretTraceRegistry([], scope)
    parent.markIncomplete('entry-decrypt-failed')
    const fork = parent.forkForToolCall()
    mockLogger.error.mockClear()

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'agent.toolInput',
        message: 'Agent tool input could not be safely projected',
        registry: fork,
      })
    ).toThrow()

    const details = refusalRecords()[0][1] as { reason: string; reasons: string[]; cause: string }
    expect(details.reason).toBe('entry-decrypt-failed')
    expect(details.reasons).toContain('inherited-incomplete-source')
    expect(details.cause).toBe('registry-latched')
  })

  it('reports a repeated boundary once per registry, so a loop cannot flood', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    registry.markIncomplete('projection-mismatch')

    for (let iteration = 0; iteration < 25; iteration++) {
      expect(() =>
        refuseResolvedSecretProjection({
          site: 'agent.toolInput',
          message: 'Agent tool input could not be safely projected',
          registry,
        })
      ).toThrow()
    }

    expect(refusalRecords()).toHaveLength(1)
  })

  it('reports distinct boundaries separately within one registry', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    registry.markIncomplete('projection-mismatch')

    for (const site of ['agent.coreModelInput', 'agent.toolInput']) {
      expect(() => refuseResolvedSecretProjection({ site, message: 'refused', registry })).toThrow()
    }

    expect(refusalRecords().map(([, d]) => (d as { site: string }).site)).toEqual([
      'agent.coreModelInput',
      'agent.toolInput',
    ])
  })

  it('separates a latched registry from a caller-side cross-check', () => {
    const complete = new ResolvedSecretTraceRegistry([], scope)

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'agent.responseFormatObjectShape',
        message: 'Agent model input could not be safely projected',
        registry: complete,
      })
    ).toThrow()

    expect(refusalRecords()[0][1]).toEqual(
      expect.objectContaining({ cause: 'projection-cross-check', registryPresent: true })
    )
  })

  it('reports the same boundary separately for different input paths', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    registry.markIncomplete('projection-mismatch')

    for (const inputPath of ['function_call', 'tool_calls.function']) {
      expect(() =>
        refuseResolvedSecretProjection({
          site: 'memory.functionCallShape',
          message: 'Memory content could not be safely projected',
          registry,
          inputPath,
        })
      ).toThrow()
    }

    expect(refusalRecords()).toHaveLength(2)
  })

  it('reports a registry-less refusal every time, since a later request is a new incident', () => {
    for (let request = 0; request < 3; request++) {
      expect(() =>
        refuseResolvedSecretProjection({
          site: 'copilot.initialAttachmentsShape',
          message: 'Copilot model input could not be safely projected',
        })
      ).toThrow()
    }

    expect(refusalRecords()).toHaveLength(3)
  })

  it('names the importer that condemned the run, through the fork and merge that hid it', async () => {
    const parent = new ResolvedSecretTraceRegistry([], scope)
    const fork = parent.forkForToolCall()
    await fork.importCrossingProvenance(
      { version: 1, complete: false, entries: [], scope },
      { rows: [] },
      { trusted: true, origin: 'tool.table_query_rows' }
    )
    parent.mergeToolCallRegistry(fork)
    mockLogger.error.mockClear()
    mockLogger.warn.mockClear()

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'router.contextModelInput',
        message: 'Router model input could not be safely projected',
        registry: parent,
        inputPath: 'context,routes',
      })
    ).toThrow()

    expect(refusalRecords()[0][1]).toEqual(
      expect.objectContaining({
        reason: 'source-provenance-incomplete',
        origins: ['tool.table_query_rows'],
      })
    )
  })

  it('records no secret material', () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'API_KEY', plaintext: 'super-secret-value', encryptedValue: 'encrypted' }],
      scope
    )
    registry.recordResolved('API_KEY', 'super-secret-value')
    registry.markIncomplete('projection-mismatch')

    expect(() =>
      refuseResolvedSecretProjection({
        site: 'agent.coreModelInput',
        message: 'Agent model input could not be safely projected',
        registry,
      })
    ).toThrow()

    const logged = JSON.stringify(refusalRecords())
    expect(logged).not.toContain('super-secret-value')
    expect(logged).not.toContain('API_KEY')
  })
})
