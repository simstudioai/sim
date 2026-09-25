import { describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
}))

import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

function refusalRecords() {
  return mockLogger.error.mock.calls.filter(
    ([message]) => message === 'Resolved secret projection refused'
  )
}

describe('refuseResolvedSecretProjection', () => {
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
