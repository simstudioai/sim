/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

import { createBackfillExecutionSecretRegistry } from '@/lib/table/backfill-runner'
import { createTableRowSecretProvenanceFromRegistry } from '@/lib/table/rows/secret-provenance'

const SCOPE = { userId: 'user-1', workspaceId: 'workspace-1' }

function currentExecutionState(
  provenance: unknown,
  sourceExecutionId = 'execution-1'
): Record<string, unknown> {
  return {
    executionState: {
      sourceExecutionId,
      resolvedSecretTraceCheckpointVersion: 1,
      resolvedSecretTraceProvenance: provenance,
    },
  }
}

describe('table output backfill provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: encryptedValue === 'encrypted-secret' ? 'secret-value' : encryptedValue,
    }))
  })

  it('filters a current persisted checkpoint to each backfilled cell', async () => {
    const registry = await createBackfillExecutionSecretRegistry({
      executionData: currentExecutionState({
        version: 1,
        complete: true,
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
        scope: SCOPE,
      }),
      executionId: 'execution-1',
      workspaceId: SCOPE.workspaceId,
    })

    expect(
      createTableRowSecretProvenanceFromRegistry(
        { secret: 'secret-value', public: 'hello' },
        registry
      )
    ).toEqual({
      complete: true,
      columns: {
        secret: {
          version: 1,
          complete: true,
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
          scope: SCOPE,
        },
        public: { version: 1, complete: true, entries: [], scope: SCOPE },
      },
    })
  })

  it('preserves a current exact-empty checkpoint for public backfill output', async () => {
    const registry = await createBackfillExecutionSecretRegistry({
      executionData: currentExecutionState({
        version: 1,
        complete: true,
        entries: [],
        scope: SCOPE,
      }),
      executionId: 'execution-1',
      workspaceId: SCOPE.workspaceId,
    })

    expect(createTableRowSecretProvenanceFromRegistry({ public: 'hello' }, registry)).toEqual({
      complete: true,
      columns: {
        public: { version: 1, complete: true, entries: [], scope: SCOPE },
      },
    })
  })

  it.each([
    ['legacy state', {}],
    [
      'stale execution binding',
      currentExecutionState(
        { version: 1, complete: true, entries: [], scope: SCOPE },
        'different-execution'
      ),
    ],
    [
      'malformed checkpoint',
      currentExecutionState({
        version: 1,
        complete: true,
        entries: [{ name: 'API_KEY' }],
        scope: SCOPE,
      }),
    ],
    [
      'foreign workspace checkpoint',
      currentExecutionState({
        version: 1,
        complete: true,
        entries: [],
        scope: { userId: 'user-1', workspaceId: 'workspace-2' },
      }),
    ],
  ])(
    'keeps %s unknown instead of inventing exact-empty provenance',
    async (_label, executionData) => {
      const registry = await createBackfillExecutionSecretRegistry({
        executionData,
        executionId: 'execution-1',
        workspaceId: SCOPE.workspaceId,
      })

      expect(createTableRowSecretProvenanceFromRegistry({ public: 'hello' }, registry)).toEqual({
        complete: false,
        columns: {},
      })
    }
  )

  it('keeps an undecryptable persisted checkpoint unknown', async () => {
    mockDecryptSecret.mockRejectedValueOnce(new Error('cannot decrypt'))
    const registry = await createBackfillExecutionSecretRegistry({
      executionData: currentExecutionState({
        version: 1,
        complete: true,
        entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
        scope: SCOPE,
      }),
      executionId: 'execution-1',
      workspaceId: SCOPE.workspaceId,
    })

    expect(createTableRowSecretProvenanceFromRegistry({ public: 'hello' }, registry)).toEqual({
      complete: false,
      columns: {},
    })
  })
})
