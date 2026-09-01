import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret, mockLogger } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
}))

import {
  ANONYMOUS_SECRET_TRACE_REPLACEMENT,
  createIncompleteResolvedSecretTraceRegistry,
  createResolvedSecretTraceRegistry,
  isResolvedSecretProvenanceAbsence,
  isResolvedSecretTraceProvenanceV1,
  RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
  ResolvedSecretTraceProvenanceAccumulator,
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

describe('provenance absence classification', () => {
  it.each([
    'value-provenance-absent',
    'source-provenance-incomplete',
    'constructed-incomplete',
    'log-creation-skipped',
    'durable-provenance-unknown',
    'inherited-incomplete-source',
    'inherited-incomplete-input-path',
  ] as const)('classifies %s as an absence, since no material transited the latch', (reason) => {
    expect(isResolvedSecretProvenanceAbsence(reason)).toBe(true)
  })

  /**
   * Warn-level is not absence: `value-provenance-filter-incomplete` latches after a staged
   * source registry decrypted real entries it could not narrow to the value, so plaintext was in
   * flight without ever activating. The absence set must stay narrower than the report split.
   */
  it.each([
    'value-provenance-filter-incomplete',
    'value-provenance-import-failed',
    'entry-decrypt-failed',
    'projection-mismatch',
    'untrusted-provenance',
    'restored-provenance-untrusted',
    'client-tool-seal-failed',
  ] as const)('keeps %s out of the absence set', (reason) => {
    expect(isResolvedSecretProvenanceAbsence(reason)).toBe(false)
  })
})

describe('ResolvedSecretTraceProvenanceAccumulator', () => {
  const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

  it('unions cold, warm, and retry reports while complete', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' }],
        scope,
      })
    ).toBe(true)
    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' }],
        scope,
      })
    ).toBe(true)
    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' }],
      scope,
    })

    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [
        { name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' },
        { name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' },
      ],
      scope,
    })
  })

  it('discards accumulated and future entries once completeness is lost', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' }],
      scope,
    })
    expect(
      accumulator.record({
        version: 1,
        complete: false,
        entries: [],
        scope,
      })
    ).toBe(true)
    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' }],
        scope,
      })
    ).toBe(true)

    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })
  })

  it('discards mismatched-scope reports and marks them incomplete', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-value' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-2' },
      })
    ).toBe(true)

    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })
  })

  it('fails closed for malformed reports and terminal incompleteness', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)
    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-value' }],
      scope,
    })

    expect(accumulator.record({ version: 1 })).toBe(false)
    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })

    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-value' }],
      scope,
    })
    accumulator.markIncomplete('unspecified')
    expect(accumulator.exportProvenance().entries).toEqual([])
  })

  /**
   * The exported bundle carries only `complete`, so an importer can never say more than
   * `source-provenance-incomplete`. If this line does not name the guard, nothing does.
   */
  it('names the first guard that latched, and stays quiet for the rest of the invocation', () => {
    vi.clearAllMocks()
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    accumulator.markIncomplete('file-source-unidentified')
    accumulator.markIncomplete('workspace-file-provenance-unknown')

    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret provenance accumulator marked incomplete',
      expect.objectContaining({
        reason: 'file-source-unidentified',
        scopeWorkspaceId: 'workspace-1',
      })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  /** A merge of already-reported bundles adds nothing; subflow aggregation runs it per iteration. */
  it('stays silent when a recorded report is what latched it', () => {
    vi.clearAllMocks()
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    accumulator.record({ version: 1, complete: false, entries: [], scope })

    expect(accumulator.exportProvenance().complete).toBe(false)
    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})

describe('ResolvedSecretTraceRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `decrypted:${encryptedValue}`,
    }))
  })

  it('starts with an inert catalog and activates only an exact successful resolution', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-value' },
    ])

    expect(registry.getActiveMatches()).toEqual([])
    expect(registry.recordResolved('API_KEY', 'wrong-value')).toBe(false)
    expect(registry.recordResolved('MISSING', 'secret-value')).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
    expect(registry.isComplete()).toBe(false)

    expect(registry.recordResolved('API_KEY', 'secret-value')).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
    ])
  })

  it('keeps dormant catalog values out of model-egress snapshots', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-value' },
    ])

    expect(registry.getActiveMatches()).toEqual([])
    const snapshot = registry.getModelEgressSnapshot()
    expect(snapshot.complete).toBe(true)
    if (snapshot.complete) {
      expect(snapshot.matches).toEqual([])
    }
  })

  it('projects only resolver-recorded leaves and never rewrites sibling bytes or object keys', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'x', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolvedAtInputPath('TOKEN', 'x', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'Box x', 'Box {{TOKEN}}')
    const unrelatedNonCloneableInput = () => 'unchanged'

    expect(
      registry.projectResolvedInputSelection({
        prompt: 'Box x',
        auxiliary: 'xylophone',
        Box: 'unchanged',
        unrelatedNonCloneableInput,
      })
    ).toEqual({
      complete: true,
      value: {
        prompt: 'Box {{TOKEN}}',
        auxiliary: 'xylophone',
        Box: 'unchanged',
        unrelatedNonCloneableInput,
      },
    })
  })

  it('keeps equal secret values causally bound to their own resolver paths', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: 'true', encryptedValue: 'encrypted-first' },
      { name: 'SECOND', plaintext: 'true', encryptedValue: 'encrypted-second' },
    ])
    registry.recordResolvedAtInputPath('FIRST', 'true', ['first'])
    registry.recordResolvedInputProjection(['first'], 'true', '{{FIRST}}')
    registry.recordResolvedAtInputPath('SECOND', 'true', ['second'])
    registry.recordResolvedInputProjection(['second'], 'true', '{{SECOND}}')

    expect(registry.projectResolvedInputSelection({ first: 'true', second: 'true' })).toEqual({
      complete: true,
      value: { first: '{{FIRST}}', second: '{{SECOND}}' },
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['first']])).toMatchObject({
      complete: true,
      entries: [{ name: 'FIRST', encryptedValue: 'encrypted-first' }],
    })
  })

  it('isolates incomplete provenance to its known input path', async () => {
    const registry = new ResolvedSecretTraceRegistry()

    expect(
      await registry.importProvenanceForValueAtInputPath(
        { version: 1 },
        'unknown-value',
        ['tools', '0', 'params', 'apiKey'],
        { trusted: true }
      )
    ).toEqual({ success: false, matched: false })

    expect(registry.isComplete()).toBe(false)
    expect(registry.projectResolvedInputSelection({ userPrompt: 'Public prompt' })).toEqual({
      complete: true,
      value: { userPrompt: 'Public prompt' },
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['userPrompt']])).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
    expect(registry.forkForInputPaths([['userPrompt']]).isComplete()).toBe(true)
  })

  it('propagates authenticated incomplete provenance without classifying it as malformed', async () => {
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
    const registry = new ResolvedSecretTraceRegistry([], scope)

    expect(
      await registry.importProvenanceForValueAtInputPath(
        { version: 1, complete: false, entries: [], scope },
        'untrusted value',
        ['toolResult'],
        { trusted: true }
      )
    ).toEqual({ success: true, matched: false })
    expect(registry.forkForInputPaths([['publicPrompt']]).isComplete()).toBe(true)
    expect(registry.forkForInputPaths([['toolResult']]).isComplete()).toBe(false)
  })

  it('localizes a failed exact resolution when the resolver supplies its input path', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'expected', encryptedValue: 'encrypted-token' },
    ])

    expect(
      registry.recordResolvedAtInputPath('TOKEN', 'unexpected', ['tools', '0', 'params', 'apiKey'])
    ).toBe(false)

    expect(registry.projectResolvedInputSelection({ userPrompt: 'Public prompt' })).toEqual({
      complete: true,
      value: { userPrompt: 'Public prompt' },
    })
    expect(registry.forkForInputPaths([['userPrompt']]).isComplete()).toBe(true)
    expect(registry.forkForInputPaths([['tools', '0', 'params']]).isComplete()).toBe(false)
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: false })
  })

  it('fails closed for a selected unknown path and arbitrary output projection', async () => {
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
    const registry = new ResolvedSecretTraceRegistry([], scope)
    await registry.importProvenanceForValueAtInputPath(
      { version: 1 },
      'unknown-value',
      ['tools', '0', 'params', 'apiKey'],
      { trusted: true }
    )

    expect(
      registry.projectResolvedInputSelection({ tools: [{ params: { apiKey: 'value' } }] })
    ).toEqual({ complete: false })
    expect(registry.exportCommittedProvenanceForInputPaths([['tools', '0', 'params']])).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })
    expect(registry.forkForInputPaths([['tools', '0', 'params']]).isComplete()).toBe(false)
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: false })
    expect(registry.exportProvenanceForValue('arbitrary output')).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })
  })

  it('propagates only selected input-path entries when explicitly requested', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SELECTED', plaintext: 'selected', encryptedValue: 'encrypted-selected' },
      { name: 'UNSELECTED', plaintext: 'unselected', encryptedValue: 'encrypted-unselected' },
    ])
    registry.recordResolvedAtInputPath('SELECTED', 'selected', ['selected'])
    registry.recordResolvedAtInputPath('UNSELECTED', 'unselected', ['unselected'])

    const ordinaryFork = registry.forkForInputPaths([['selected']])
    expect(ordinaryFork.forkForPropagatedEntries().exportProvenance().entries).toEqual([])

    const propagatedFork = registry.forkForInputPaths([['selected']], { propagated: true })
    expect(propagatedFork.forkForPropagatedEntries().exportProvenance().entries).toEqual([
      { name: 'SELECTED', encryptedValue: 'encrypted-selected' },
    ])
    expect(propagatedFork.exportProvenance().entries).not.toContainEqual({
      name: 'UNSELECTED',
      encryptedValue: 'encrypted-unselected',
    })
  })

  it('preserves exact paths through renamed and parsed parameter transforms', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: 'true', encryptedValue: 'encrypted-first' },
      { name: 'SECOND', plaintext: 'true', encryptedValue: 'encrypted-second' },
      { name: 'UNUSED', plaintext: 'true', encryptedValue: 'encrypted-unused' },
    ])
    registry.recordResolvedAtInputPath('FIRST', 'true', ['rowTemplate'])
    registry.recordResolvedAtInputPath('SECOND', 'true', ['rowTemplate'])
    registry.recordResolvedInputProjection(
      ['rowTemplate'],
      '{"first":true,"second":true,"public":true}',
      '{"first":{{FIRST}},"second":{{SECOND}},"public":true}'
    )

    registry.recordTransformedInputProjection(
      { data: { first: true, second: true, public: true } },
      { data: { first: '{{FIRST}}', second: '{{SECOND}}', public: true } }
    )

    expect(
      registry.projectResolvedInputSelection({
        data: { first: true, second: true, public: true },
      })
    ).toEqual({
      complete: true,
      value: {
        data: { first: '{{FIRST}}', second: '{{SECOND}}', public: true },
      },
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'first']])).toMatchObject({
      complete: true,
      entries: [{ name: 'FIRST', encryptedValue: 'encrypted-first' }],
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'second']])).toMatchObject({
      complete: true,
      entries: [{ name: 'SECOND', encryptedValue: 'encrypted-second' }],
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['data', 'public']])).toMatchObject({
      complete: true,
      entries: [],
    })
  })

  it('narrows each grouped export to its own root', () => {
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
    const registry = new ResolvedSecretTraceRegistry(
      [
        { name: 'FIRST', plaintext: 'alpha', encryptedValue: 'encrypted-first' },
        { name: 'SECOND', plaintext: 'beta', encryptedValue: 'encrypted-second' },
      ],
      scope
    )
    registry.recordResolvedAtInputPath('FIRST', 'alpha', ['rows', '0', 'a'])
    registry.recordResolvedAtInputPath('SECOND', 'beta', ['rows', '1', 'b'])
    registry.recordResolvedAtInputPath('FIRST', 'alpha', ['rows', '2', 'c', 'nested'])

    const exported = registry.exportCommittedProvenanceForInputPathGroups([
      [['rows', '0', 'a']],
      [['rows', '1', 'b']],
      [['rows', '2', 'c']],
      [['rows']],
      [['rows', '3', 'untouched']],
      [],
      [
        ['rows', '0', 'a'],
        ['rows', '1', 'b'],
      ],
    ])

    expect(exported.map((provenance) => provenance.entries)).toEqual([
      [{ name: 'FIRST', encryptedValue: 'encrypted-first' }],
      [{ name: 'SECOND', encryptedValue: 'encrypted-second' }],
      [{ name: 'FIRST', encryptedValue: 'encrypted-first' }],
      [
        { name: 'FIRST', encryptedValue: 'encrypted-first' },
        { name: 'SECOND', encryptedValue: 'encrypted-second' },
      ],
      [],
      [],
      [
        { name: 'FIRST', encryptedValue: 'encrypted-first' },
        { name: 'SECOND', encryptedValue: 'encrypted-second' },
      ],
    ])
    expect(exported.every((provenance) => provenance.complete)).toBe(true)
  })

  it('fails only the grouped exports an incomplete input path overlaps', async () => {
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'FIRST', plaintext: 'alpha', encryptedValue: 'encrypted-first' }],
      scope
    )
    registry.recordResolvedAtInputPath('FIRST', 'alpha', ['rows', '0', 'a'])
    await registry.importProvenanceForValueAtInputPath(null, 'alpha', ['rows', '1', 'b'], {
      trusted: false,
    })

    const exported = registry.exportCommittedProvenanceForInputPathGroups([
      [['rows', '1', 'b']],
      [['rows', '1']],
      [['rows', '1', 'b', 'deeper']],
      [['rows', '0', 'a']],
    ])

    expect(exported.map((provenance) => provenance.complete)).toEqual([false, false, false, true])
    expect(exported[3].entries).toEqual([{ name: 'FIRST', encryptedValue: 'encrypted-first' }])
  })

  it('fails closed when independent secret paths collapse into one transformed string', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: 'first', encryptedValue: 'encrypted-first' },
      { name: 'SECOND', plaintext: 'second', encryptedValue: 'encrypted-second' },
    ])
    registry.recordResolvedAtInputPath('FIRST', 'first', ['first'])
    registry.recordResolvedInputProjection(['first'], 'first', '{{FIRST}}')
    registry.recordResolvedAtInputPath('SECOND', 'second', ['second'])
    registry.recordResolvedInputProjection(['second'], 'second', '{{SECOND}}')

    registry.recordTransformedInputProjection(
      { combined: 'first:second' },
      { combined: '{{FIRST}}:second' }
    )
    registry.recordTransformedInputProjection(
      { combined: 'first:second' },
      { combined: 'first:{{SECOND}}' }
    )

    expect(registry.isComplete()).toBe(false)
    expect(registry.projectResolvedInputSelection({ unrelated: 'public' })).toEqual({
      complete: true,
      value: { unrelated: 'public' },
    })
    expect(registry.projectResolvedInputSelection({ combined: 'first:second' })).toEqual({
      complete: false,
    })
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: false })
  })

  it('does not invalidate the model matcher for duplicate activations', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-value' },
    ])

    expect(registry.recordResolved('API_KEY', 'secret-value')).toBe(true)
    const revision = registry.getModelEgressRevision()
    expect(registry.recordResolved('API_KEY', 'secret-value')).toBe(true)
    expect(registry.getModelEgressRevision()).toBe(revision)
  })

  it('fails model egress closed when activated provenance cannot be compiled into a matcher', () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'OVERSIZED',
        plaintext: 's'.repeat(64 * 1024 + 1),
        encryptedValue: 'encrypted-value',
      },
    ])

    expect(registry.isComplete()).toBe(true)
    expect(registry.recordResolved('OVERSIZED', 's'.repeat(64 * 1024 + 1))).toBe(true)
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: false })
  })

  it('fails model egress closed when activated matcher nodes exceed the compiler limit', () => {
    const suffix = 'x'.repeat(62_500)
    const registry = new ResolvedSecretTraceRegistry(
      ['a', 'b', 'c', 'd'].map((prefix, index) => ({
        name: `SECRET_${index}`,
        plaintext: `${prefix}${suffix}`,
        encryptedValue: `encrypted-${index}`,
      }))
    )

    expect(registry.isComplete()).toBe(true)
    for (let index = 0; index < 4; index++) {
      expect(
        registry.recordResolved(`SECRET_${index}`, `${['a', 'b', 'c', 'd'][index]}${suffix}`)
      ).toBe(true)
    }
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: false })
  })

  it('uses anonymous model replacement when local and foreign entries share plaintext', async () => {
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'same-secret' })
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'LOCAL', plaintext: 'same-secret', encryptedValue: 'local-ciphertext' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    await registry.importProvenance(
      {
        version: 1,
        complete: true,
        entries: [{ name: 'FOREIGN', encryptedValue: 'foreign-ciphertext' }],
        scope: { userId: 'user-2', workspaceId: 'workspace-2' },
      },
      { trusted: true }
    )

    const snapshot = registry.getModelEgressSnapshot()
    expect(snapshot.complete).toBe(true)
    if (snapshot.complete) {
      expect(snapshot.matches).toContainEqual({
        plaintext: 'same-secret',
        replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
      })
    }
  })

  it('keeps a named anonymous secret distinct from anonymous provenance', async () => {
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'same-secret' })
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'anonymous', plaintext: 'same-secret', encryptedValue: 'shared-ciphertext' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('anonymous', 'same-secret')
    await registry.importProvenance(
      {
        version: 1,
        complete: true,
        entries: [{ encryptedValue: 'shared-ciphertext' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
      { trusted: true, anonymous: true }
    )

    expect(registry.exportCommittedProvenanceForValue('same-secret')).toEqual({
      version: 1,
      complete: true,
      entries: [
        { encryptedValue: 'shared-ciphertext' },
        { name: 'anonymous', encryptedValue: 'shared-ciphertext' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    const snapshot = registry.getModelEgressSnapshot()
    expect(snapshot.complete).toBe(true)
    if (snapshot.complete) {
      expect(snapshot.matches).toContainEqual({
        plaintext: 'same-secret',
        replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
      })
    }
  })

  it('projects committed provenance while temporary activations are pending', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-value' },
    ])
    const completeFirst = registry.beginPendingActivation()
    const completeSecond = registry.beginPendingActivation()

    expect(registry.isComplete()).toBe(false)
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: true, matches: [] })
    expect(registry.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
    })

    registry.recordResolved('API_KEY', 'secret-value')
    expect(registry.getModelEgressSnapshot()).toEqual({
      complete: true,
      matches: expect.arrayContaining([{ plaintext: 'secret-value', replacement: '{{API_KEY}}' }]),
    })
    expect(registry.exportCheckpointProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-value' }],
    })
    expect(registry.exportCommittedProvenanceForValue('Bearer secret-value')).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-value' }],
    })

    completeFirst()
    expect(registry.isComplete()).toBe(false)

    completeSecond()
    completeSecond()
    expect(registry.isComplete()).toBe(true)
    expect(registry.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-value' }],
    })
  })

  it('uses the workspace catalog entry when personal and workspace names conflict', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { SHARED: 'personal-encrypted' },
      workspaceEncrypted: { SHARED: 'workspace-encrypted' },
      personalDecrypted: { SHARED: 'personal-secret' },
      workspaceDecrypted: { SHARED: 'workspace-secret' },
    })

    expect(registry.recordResolved('SHARED', 'workspace-secret')).toBe(true)
    expect(registry.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'SHARED', encryptedValue: 'workspace-encrypted' }],
    })
  })

  describe('getResolvedSecretUsage', () => {
    it('reports only the secrets a run actually resolved, with their scope', async () => {
      const registry = await createResolvedSecretTraceRegistry({
        personalEncrypted: { PERSONAL_KEY: 'personal-encrypted' },
        workspaceEncrypted: { WORKSPACE_KEY: 'workspace-encrypted', UNUSED: 'unused-encrypted' },
        personalDecrypted: { PERSONAL_KEY: 'personal-secret' },
        workspaceDecrypted: { WORKSPACE_KEY: 'workspace-secret', UNUSED: 'unused-secret' },
        personalOwners: { PERSONAL_KEY: 'owner-1' },
      })

      expect(registry.recordResolved('PERSONAL_KEY', 'personal-secret')).toBe(true)
      expect(registry.recordResolved('WORKSPACE_KEY', 'workspace-secret')).toBe(true)

      expect(registry.getResolvedSecretUsage()).toEqual([
        { name: 'PERSONAL_KEY', scope: 'personal', ownerUserId: 'owner-1' },
        { name: 'WORKSPACE_KEY', scope: 'workspace', ownerUserId: null },
      ])
    })

    /**
     * A personal secret shared into the workspace resolves for someone who does not own it.
     * The trail is read per owner, so it has to be filed under the sharer or it would show up
     * under the borrower's own same-named secret.
     */
    it('attributes a shared personal secret to its owner, not the resolving caller', async () => {
      const registry = await createResolvedSecretTraceRegistry({
        personalEncrypted: { SHARED_KEY: 'personal-encrypted' },
        workspaceEncrypted: {},
        personalDecrypted: { SHARED_KEY: 'shared-secret' },
        workspaceDecrypted: {},
        personalOwners: { SHARED_KEY: 'sharer-1' },
        scope: { userId: 'borrower-1', workspaceId: 'workspace-1' },
      })

      expect(registry.recordResolved('SHARED_KEY', 'shared-secret')).toBe(true)
      expect(registry.getResolvedSecretUsage()).toEqual([
        { name: 'SHARED_KEY', scope: 'personal', ownerUserId: 'sharer-1' },
      ])
    })

    /**
     * Recording an unattributed personal row would surface it under every other user's
     * secret of the same name, so it is dropped instead.
     */
    it('drops a personal secret whose owner is unknown', async () => {
      const registry = await createResolvedSecretTraceRegistry({
        personalEncrypted: { PERSONAL_KEY: 'personal-encrypted' },
        workspaceEncrypted: {},
        personalDecrypted: { PERSONAL_KEY: 'personal-secret' },
        workspaceDecrypted: {},
      })

      expect(registry.recordResolved('PERSONAL_KEY', 'personal-secret')).toBe(true)
      expect(registry.getResolvedSecretUsage()).toEqual([])
    })

    it('is empty when a configured secret was never resolved', async () => {
      const registry = await createResolvedSecretTraceRegistry({
        personalEncrypted: {},
        workspaceEncrypted: { API_KEY: 'workspace-encrypted' },
        personalDecrypted: {},
        workspaceDecrypted: { API_KEY: 'workspace-secret' },
      })

      expect(registry.getResolvedSecretUsage()).toEqual([])
    })

    /**
     * An imported entry is a secret a sub-run or tool call already recorded against its own
     * execution; counting it again here would double it.
     */
    it('omits entries adopted from imported provenance', async () => {
      const registry = await createResolvedSecretTraceRegistry({
        personalEncrypted: {},
        workspaceEncrypted: {},
        personalDecrypted: {},
        workspaceDecrypted: {},
      })

      await registry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'CROSSED_KEY', encryptedValue: 'crossed-encrypted' }],
        },
        { trusted: true }
      )

      expect(registry.getResolvedSecretUsage()).toEqual([])
    })
  })

  it('ignores empty decryption failures but fails closed for a resolved value outside the catalog', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { FAILED: 'failed-ciphertext' },
      workspaceEncrypted: {},
      personalDecrypted: { FAILED: '', DECRYPTED_ONLY: 'not-catalogued' },
      workspaceDecrypted: {},
      decryptionFailures: ['FAILED'],
    })

    expect(registry.isComplete()).toBe(true)
    expect(registry.recordResolved('FAILED', '')).toBe(false)
    expect(registry.isComplete()).toBe(true)
    expect(registry.recordResolved('DECRYPTED_ONLY', 'not-catalogued')).toBe(false)
    expect(registry.isComplete()).toBe(false)
  })

  it('keeps a successful workspace override when the shadowed personal value failed', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { SHARED: 'broken-personal-ciphertext' },
      workspaceEncrypted: { SHARED: 'workspace-ciphertext' },
      personalDecrypted: { SHARED: '' },
      workspaceDecrypted: { SHARED: 'workspace-secret' },
      decryptionFailures: ['SHARED'],
    })

    expect(registry.recordResolved('SHARED', 'workspace-secret')).toBe(true)
    expect(registry.exportProvenance().entries).toEqual([
      { name: 'SHARED', encryptedValue: 'workspace-ciphertext' },
    ])
  })

  it('exports encrypted active provenance without plaintext', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'raw-secret', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'raw-secret')

    const serialized = JSON.stringify(registry.exportProvenance())
    expect(serialized).toContain('ciphertext')
    expect(serialized).not.toContain('raw-secret')
  })

  it('restores old encrypted values alongside the current catalog after rotation', async () => {
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'old-secret' })
    const oldProvenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'old-ciphertext' }],
    }
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { TOKEN: 'new-ciphertext' },
      workspaceEncrypted: {},
      personalDecrypted: { TOKEN: 'new-secret' },
      workspaceDecrypted: {},
      restoredProvenance: oldProvenance,
      restoredCheckpointVersion: RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
      restoreTrusted: true,
      requireRestoredProvenance: true,
    })

    registry.recordResolved('TOKEN', 'new-secret')

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'new-secret', replacement: '{{TOKEN}}' },
      { plaintext: 'old-secret', replacement: '{{TOKEN}}' },
    ])
    expect(registry.exportProvenance().entries).toEqual([
      { name: 'TOKEN', encryptedValue: 'new-ciphertext' },
      { name: 'TOKEN', encryptedValue: 'old-ciphertext' },
    ])
  })

  it('keeps a trusted legacy checkpoint untracked instead of scanning restored state', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { TOKEN: 'legacy-ciphertext' },
      workspaceEncrypted: {},
      personalDecrypted: { TOKEN: 'legacy-secret' },
      workspaceDecrypted: {},
      restoreTrusted: true,
      requireRestoredProvenance: true,
    })

    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(mockDecryptSecret).not.toHaveBeenCalled()
    expect(JSON.stringify(registry.exportCheckpointProvenance())).not.toContain('legacy-secret')
  })

  it('does not inspect arbitrarily large legacy checkpoint state', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { TOKEN: 'ciphertext' },
      workspaceEncrypted: {},
      personalDecrypted: { TOKEN: 'secret-value' },
      workspaceDecrypted: {},
      restoreTrusted: true,
      requireRestoredProvenance: true,
    })

    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('marks untrusted, current-missing, malformed, and undecryptable restoration incomplete', async () => {
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
    }
    const untrusted = new ResolvedSecretTraceRegistry()
    expect(await untrusted.importProvenance(provenance, { trusted: false })).toBe(false)
    expect(untrusted.isComplete()).toBe(false)
    expect(mockDecryptSecret).not.toHaveBeenCalled()

    const missing = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      restoredCheckpointVersion: RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
      requireRestoredProvenance: true,
      restoreTrusted: true,
    })
    expect(missing.isComplete()).toBe(false)

    const malformed = new ResolvedSecretTraceRegistry()
    expect(await malformed.importProvenance({ version: 1 }, { trusted: true })).toBe(false)
    expect(malformed.isComplete()).toBe(false)

    mockDecryptSecret.mockRejectedValueOnce(new Error('cannot decrypt'))
    const undecryptable = new ResolvedSecretTraceRegistry()
    expect(await undecryptable.importProvenance(provenance, { trusted: true })).toBe(false)
    expect(undecryptable.isComplete()).toBe(false)
  })

  it('uses anonymous replacements for cross-scope provenance', async () => {
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'publisher-secret' })
    const registry = new ResolvedSecretTraceRegistry()
    await registry.importProvenance(
      {
        version: 1,
        complete: true,
        entries: [{ name: 'PUBLISHER_TOKEN', encryptedValue: 'publisher-ciphertext' }],
      },
      { trusted: true, anonymous: true }
    )

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'publisher-secret', replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT },
    ])
    expect(registry.exportProvenance().entries).toEqual([
      { encryptedValue: 'publisher-ciphertext' },
    ])
  })

  it('preserves labels only when imported provenance has the same complete scope', async () => {
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    const sameScope = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const mismatchedScope = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-2',
    })
    const differentUserSameWorkspace = new ResolvedSecretTraceRegistry([], {
      userId: 'user-2',
      workspaceId: 'workspace-1',
    })
    const missingReceiverScope = new ResolvedSecretTraceRegistry()
    const missingSourceScope = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(await sameScope.importProvenance(provenance, { trusted: true })).toBe(true)
    expect(await mismatchedScope.importProvenance(provenance, { trusted: true })).toBe(true)
    expect(await differentUserSameWorkspace.importProvenance(provenance, { trusted: true })).toBe(
      true
    )
    expect(await missingReceiverScope.importProvenance(provenance, { trusted: true })).toBe(true)
    expect(
      await missingSourceScope.importProvenance(
        { version: 1, complete: true, entries: provenance.entries },
        { trusted: true }
      )
    ).toBe(true)

    expect(sameScope.getActiveMatches()).toEqual([
      { plaintext: 'decrypted:ciphertext', replacement: '{{TOKEN}}' },
    ])
    for (const registry of [
      mismatchedScope,
      differentUserSameWorkspace,
      missingReceiverScope,
      missingSourceScope,
    ]) {
      expect(registry.getActiveMatches()).toEqual([
        {
          plaintext: 'decrypted:ciphertext',
          replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
        },
      ])
    }
  })

  it('filters same-scope provenance to the exact crossing value while preserving its name', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [
        { name: 'PRESENT', encryptedValue: 'present-ciphertext' },
        { name: 'DORMANT_IN_OUTPUT', encryptedValue: 'other-ciphertext' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }

    expect(
      await registry.importCrossingProvenance(
        provenance,
        { output: 'decrypted:present-ciphertext' },
        { trusted: true }
      )
    ).toBe(true)

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'decrypted:present-ciphertext', replacement: '{{PRESENT}}' },
    ])
  })

  it('filters and anonymizes provenance crossing from another scope', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [
        { name: 'PRESENT', encryptedValue: 'present-ciphertext' },
        { name: 'ABSENT', encryptedValue: 'absent-ciphertext' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-2' },
    }

    expect(
      await registry.importCrossingProvenance(
        provenance,
        { output: 'decrypted:present-ciphertext' },
        { trusted: true }
      )
    ).toBe(true)

    expect(registry.getActiveMatches()).toEqual([
      {
        plaintext: 'decrypted:present-ciphertext',
        replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
      },
    ])
  })

  it('filters an authenticated model-input envelope to the exact crossing value', async () => {
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
    const registry = new ResolvedSecretTraceRegistry([], scope)
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [
        { name: 'PRESENT', encryptedValue: 'present-ciphertext' },
        { name: 'UNRELATED', encryptedValue: 'unrelated-ciphertext' },
      ],
      scope,
    }

    expect(
      await registry.importProvenanceForValue(
        provenance,
        { prompt: 'Use decrypted:present-ciphertext' },
        { trusted: true }
      )
    ).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'decrypted:present-ciphertext', replacement: '{{PRESENT}}' },
    ])
  })

  it('imports exact authenticated provenance from a JSON-encoded crossing value', async () => {
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
    const registry = new ResolvedSecretTraceRegistry([], scope)
    const encryptedValue = 'quote"-ciphertext'
    const plaintext = `decrypted:${encryptedValue}`

    expect(
      await registry.importProvenanceForValue(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'ESCAPED', encryptedValue }],
          scope,
        },
        JSON.stringify({ prompt: plaintext }),
        { trusted: true }
      )
    ).toBe(true)
    expect(registry.getActiveMatches()).toEqual([{ plaintext, replacement: '{{ESCAPED}}' }])
  })

  it('exports only active secrets whose exact literals cross a value boundary', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PRESENT', plaintext: 'present-secret', encryptedValue: 'present-ciphertext' },
      { name: 'ABSENT', plaintext: 'absent-secret', encryptedValue: 'absent-ciphertext' },
      { name: 'UNUSED', plaintext: 'unused-secret', encryptedValue: 'unused-ciphertext' },
    ])
    registry.recordResolved('PRESENT', 'present-secret')
    registry.recordResolved('ABSENT', 'absent-secret')

    const provenance = registry.exportProvenanceForValue(
      { nested: [{ 'key-present-secret': new Error('failed with present-secret') }] },
      { anonymous: true }
    )

    expect(provenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'present-ciphertext' }],
    })
  })

  it('exports active provenance when a model-bound JSON string contains escaped secret bytes', () => {
    const secret = 'quote" slash\\ newline\n'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PRESENT', plaintext: secret, encryptedValue: 'present-ciphertext' },
    ])
    registry.recordResolved('PRESENT', secret)

    expect(
      registry.exportCommittedProvenanceForValue(
        JSON.stringify([{ role: 'user', content: secret }])
      )
    ).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'PRESENT', encryptedValue: 'present-ciphertext' }],
    })
  })

  it('exports active provenance for a registered legacy runtime alias', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API-KEY', plaintext: 'secret-value', encryptedValue: 'present-ciphertext' },
    ])
    registry.recordResolved('API-KEY', 'secret-value')

    expect(registry.exportCommittedProvenanceForValue('prefix __var_API_KEY suffix')).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API-KEY', encryptedValue: 'present-ciphertext' }],
    })
  })

  it('ignores repeated unrelated runtime aliases without exhausting the scan budget', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'present-ciphertext' },
    ])
    registry.recordResolved('API_KEY', 'secret-value')

    expect(
      registry.exportCommittedProvenanceForValue(`${'__var_Z '.repeat(1_000_001)}__var_API_KEY`)
    ).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'present-ciphertext' }],
    })
  })

  it('matches legacy runtime aliases as complete tokens instead of prefixes', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'A', plaintext: 'secret-a', encryptedValue: 'ciphertext-a' },
      { name: 'API_KEY', plaintext: 'secret-api', encryptedValue: 'ciphertext-api' },
    ])
    registry.recordResolved('A', 'secret-a')
    registry.recordResolved('API_KEY', 'secret-api')

    expect(registry.exportCommittedProvenanceForValue('__var_API_KEY')).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'ciphertext-api' }],
    })
  })

  it('conservatively retains every secret mapped to a colliding runtime alias', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API-KEY', plaintext: 'first-secret', encryptedValue: 'first-ciphertext' },
      { name: 'API_KEY', plaintext: 'second-secret', encryptedValue: 'second-ciphertext' },
    ])
    registry.recordResolved('API-KEY', 'first-secret')
    registry.recordResolved('API_KEY', 'second-secret')

    expect(registry.exportCommittedProvenanceForValue('__var_API_KEY')).toEqual({
      version: 1,
      complete: true,
      entries: [
        { name: 'API-KEY', encryptedValue: 'first-ciphertext' },
        { name: 'API_KEY', encryptedValue: 'second-ciphertext' },
      ],
    })
  })

  it('retains an alias-specific entry when multiple names share one plaintext', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: 'shared-secret', encryptedValue: 'first-ciphertext' },
      { name: 'SECOND', plaintext: 'shared-secret', encryptedValue: 'second-ciphertext' },
    ])
    registry.recordResolved('FIRST', 'shared-secret')
    registry.recordResolved('SECOND', 'shared-secret')

    expect(registry.exportCommittedProvenanceForValue('__var_SECOND')).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'SECOND', encryptedValue: 'second-ciphertext' }],
    })
  })

  it('conservatively retains every active secret that shares a raw plaintext literal', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: '4815162342', encryptedValue: 'first-ciphertext' },
      { name: 'SECOND', plaintext: '4815162342', encryptedValue: 'second-ciphertext' },
    ])
    registry.recordResolved('FIRST', '4815162342')
    registry.recordResolved('SECOND', '4815162342')

    const expected = {
      version: 1 as const,
      complete: true,
      entries: [
        { name: 'FIRST', encryptedValue: 'first-ciphertext' },
        { name: 'SECOND', encryptedValue: 'second-ciphertext' },
      ],
    }
    expect(registry.exportCommittedProvenanceForValue('4815162342')).toEqual(expected)
    expect(registry.exportCommittedProvenanceForValue(4815162342)).toEqual(expected)
  })

  it('exports active numeric literals crossing a value boundary, but not boolean or null', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'NUMBER', plaintext: '12345678', encryptedValue: 'number-ciphertext' },
      { name: 'BOOLEAN', plaintext: 'false', encryptedValue: 'boolean-ciphertext' },
      { name: 'NULL', plaintext: 'null', encryptedValue: 'null-ciphertext' },
      { name: 'ABSENT', plaintext: '56781234', encryptedValue: 'absent-ciphertext' },
    ])
    registry.recordResolved('NUMBER', '12345678')
    registry.recordResolved('BOOLEAN', 'false')
    registry.recordResolved('NULL', 'null')
    registry.recordResolved('ABSENT', '56781234')

    expect(
      registry.exportProvenanceForValue(
        { number: 12345678, boolean: false, nullable: null },
        { anonymous: true }
      )
    ).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'number-ciphertext' }],
    })
  })

  it('keeps every candidate when a bounded cross-boundary scan hits an opaque accessor', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue: 'ciphertext' },
      { name: 'ABSENT', plaintext: 'never-present', encryptedValue: 'absent-ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret')
    registry.recordResolved('ABSENT', 'never-present')
    const value = {}
    Object.defineProperty(value, 'opaque', {
      enumerable: true,
      get: () => 'secret',
    })

    expect(registry.exportProvenanceForValue(value, { anonymous: true })).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'absent-ciphertext' }, { encryptedValue: 'ciphertext' }],
    })
  })

  it('keeps every candidate rather than voiding provenance for an opaque large-value ref', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue: 'ciphertext' },
      { name: 'ABSENT', plaintext: 'never-present', encryptedValue: 'absent-ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret')
    registry.recordResolved('ABSENT', 'never-present')

    expect(
      registry.exportProvenanceForValue(
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'object',
          size: 1024,
        },
        { anonymous: true }
      )
    ).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'absent-ciphertext' }, { encryptedValue: 'ciphertext' }],
    })
  })

  it('lets a model input path survive an upstream output the scan could not read', async () => {
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
    const catalog = [
      { name: 'TOKEN', plaintext: 'decrypted:ciphertext', encryptedValue: 'ciphertext' },
    ]
    const producer = new ResolvedSecretTraceRegistry(catalog, scope)
    producer.recordResolved('TOKEN', 'decrypted:ciphertext')

    /** A block output past the traversal bound, exactly as compaction leaves a large table read. */
    const upstreamOutput = {
      rows: Array.from({ length: 5_000 }, (_, index) => ({
        id: `row_${index}`,
        a: 'a',
        b: 'b',
        c: 'c',
        d: 'd',
        e: 'e',
        f: 'f',
        g: 'g',
        h: 'h',
        i: 'i',
        j: 'j',
      })),
    }
    const upstreamProvenance = producer.exportCommittedProvenanceForValue(upstreamOutput)
    expect(upstreamProvenance.complete).toBe(true)

    const consumer = new ResolvedSecretTraceRegistry(catalog, scope)
    await consumer.importProvenanceForValueAtInputPath(
      upstreamProvenance,
      upstreamOutput,
      ['userPrompt'],
      { trusted: true }
    )

    const modelFork = consumer.forkForInputPaths([['userPrompt'], ['systemPrompt']])
    expect(modelFork.projectResolvedInputSelection({ userPrompt: 'classify these rows' })).toEqual({
      complete: true,
      value: { userPrompt: 'classify these rows' },
    })
  })

  it('still voids provenance for an unscannable value when the registry cannot vouch', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret')
    registry.markIncomplete('unverified-resolved-entry')

    expect(
      registry.exportCommittedProvenanceForValue({
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'object',
        size: 1024,
      })
    ).toEqual({ version: 1, complete: false, entries: [] })
  })

  it('does not snapshot or enqueue an entire wide crossing object', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'needle-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'needle-value')
    const wideValue: Record<string, string> = {}
    for (let index = 0; index < 30_000; index++) {
      wideValue[`field_${index}`] = 'safe-value'
    }
    const descriptorSnapshotSpy = vi.spyOn(Object, 'getOwnPropertyDescriptors')
    const provenance = registry.exportProvenanceForValue(wideValue, { anonymous: true })
    const descriptorSnapshotCalls = descriptorSnapshotSpy.mock.calls.length
    descriptorSnapshotSpy.mockRestore()

    expect(provenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'ciphertext' }],
    })
    expect(descriptorSnapshotCalls).toBe(0)
  })

  it('handles duplicate and empty values deterministically', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'Z_TOKEN', plaintext: 'samevalue', encryptedValue: 'z-ciphertext' },
      { name: 'A_TOKEN', plaintext: 'samevalue', encryptedValue: 'a-ciphertext' },
      { name: 'EMPTY', plaintext: '', encryptedValue: 'empty-ciphertext' },
      { name: 'A', plaintext: 'AAAAAAAA', encryptedValue: 'short-ciphertext' },
    ])
    registry.recordResolved('Z_TOKEN', 'samevalue')
    registry.recordResolved('A_TOKEN', 'samevalue')
    registry.recordResolved('EMPTY', '')

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'samevalue', replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT },
    ])

    registry.recordResolved('A', 'AAAAAAAA')
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'samevalue', replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT },
      { plaintext: 'AAAAAAAA', replacement: '{{A}}' },
    ])
  })

  it('marks the registry incomplete when active provenance exceeds its hard cap', () => {
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      name: `SECRET_${index}`,
      plaintext: `value-${index}`,
      encryptedValue: `ciphertext-${index}`,
    }))
    const registry = new ResolvedSecretTraceRegistry(entries)

    for (const entry of entries) {
      registry.recordResolved(entry.name, entry.plaintext)
    }

    expect(registry.isComplete()).toBe(false)
    expect(registry.exportProvenance().entries).toEqual([])
  })

  it('does not poison unrelated inputs when dormant catalog entries exceed the hard cap', () => {
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      name: `SECRET_${index}`,
      plaintext: `value-${index}`,
      encryptedValue: `ciphertext-${index}`,
    }))
    const registry = new ResolvedSecretTraceRegistry(entries)

    expect(registry.isComplete()).toBe(true)
    expect(registry.recordResolvedAtInputPath('SECRET_10000', 'value-10000', ['userPrompt'])).toBe(
      false
    )
    expect(registry.forkForInputPaths([['systemPrompt']]).isComplete()).toBe(true)
    expect(registry.forkForInputPaths([['userPrompt']]).isComplete()).toBe(false)
  })

  it('bounds provenance by serialized JSON bytes including control-character escapes', () => {
    const encryptedValue = '\u0000'.repeat(1_400_000)
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue }],
    }

    expect(Buffer.byteLength(encryptedValue, 'utf8')).toBeLessThan(8 * 1024 * 1024)
    expect(Buffer.byteLength(JSON.stringify(provenance), 'utf8')).toBeGreaterThan(8 * 1024 * 1024)
    expect(isResolvedSecretTraceProvenanceV1(provenance)).toBe(false)

    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue },
    ])
    expect(registry.recordResolved('TOKEN', 'secret')).toBe(true)
    expect(registry.isComplete()).toBe(false)
    expect(registry.exportProvenance().entries).toEqual([])
  })

  it('rejects incomplete provenance that still carries entries', () => {
    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: false,
        entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
      })
    ).toBe(false)
  })

  it('rejects non-canonical provenance fields before applying the serialized-size bound', () => {
    const entry = { name: 'TOKEN', encryptedValue: 'ciphertext' }
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: true,
        entries: [entry],
        scope,
        extra: 'not-transported',
      })
    ).toBe(false)
    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: true,
        entries: [{ ...entry, extra: 'not-transported' }],
        scope,
      })
    ).toBe(false)
    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: true,
        entries: [entry],
        scope: { ...scope, extra: 'not-transported' },
      })
    ).toBe(false)

    const entries = [entry]
    Object.assign(entries, { extra: 'not-transported' })
    expect(isResolvedSecretTraceProvenanceV1({ version: 1, complete: true, entries, scope })).toBe(
      false
    )
  })

  it('does not let a large dormant catalog poison unrelated execution provenance', () => {
    let yieldedEntries = 0
    function* catalogEntries() {
      for (let index = 0; index < 20_000; index++) {
        yieldedEntries++
        yield {
          name: `SECRET_${index}`,
          plaintext: `value-${index}`,
          encryptedValue: `ciphertext-${index}`,
        }
      }
    }

    const registry = new ResolvedSecretTraceRegistry(catalogEntries())

    expect(yieldedEntries).toBe(10_001)
    expect(registry.isComplete()).toBe(true)
    expect(registry.exportProvenance().entries).toEqual([])
  })

  it('keeps an oversized dormant value inert until that exact secret is resolved', () => {
    const oversizedPlaintext = 'x'.repeat(8 * 1024 * 1024)
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'OVERSIZED',
        plaintext: oversizedPlaintext,
        encryptedValue: 'ciphertext',
      },
      {
        name: 'NORMAL',
        plaintext: 'normal-secret',
        encryptedValue: 'normal-ciphertext',
      },
    ])

    expect(registry.isComplete()).toBe(true)
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: true, matches: [] })
    expect(registry.recordResolvedAtInputPath('NORMAL', 'normal-secret', ['systemPrompt'])).toBe(
      true
    )
    expect(
      registry.recordResolvedAtInputPath('OVERSIZED', oversizedPlaintext, ['userPrompt'])
    ).toBe(false)
    expect(registry.forkForInputPaths([['systemPrompt']]).isComplete()).toBe(true)
    expect(registry.forkForInputPaths([['userPrompt']]).isComplete()).toBe(false)
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: false })
  })
})

describe('incompleteness diagnostics', () => {
  const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

  beforeEach(() => {
    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()
  })

  it('reports an originating incompleteness at error so the default log level cannot hide it', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('projection-mismatch')

    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'projection-mismatch' })
    )
  })

  it('reports an inherited incompleteness at warn so one fault does not read as several', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('inherited-incomplete-source')

    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'inherited-incomplete-source' })
    )
  })

  /**
   * `reason` says what tripped; without this the line says nothing about where, which is the
   * difference between a signal you can act on and one you can only count.
   */
  it('carries a caller-supplied structural detail onto the reported line', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('structural-input-root-unprojected', {
      detail: { blockType: 'api', tool: 'http_request', inputPath: 'body.payload' },
    })

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({
        reason: 'structural-input-root-unprojected',
        blockType: 'api',
        tool: 'http_request',
        inputPath: 'body.payload',
      })
    )
  })

  /** A detail key must never displace the fields every one of these lines is read by. */
  /**
   * The detail type names its fields, so none of these is expressible without a cast. The runtime
   * guarantee is asserted anyway because the payload is assembled in two places — `reason` is
   * added a level above, where the caller's spread order cannot reach it — and a line whose
   * `reason` disagrees with the level it was logged at is worse than one carrying no detail.
   */
  it('does not let a detail shadow the canonical fields', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('structural-input-root-unprojected', {
      detail: {
        reason: 'spoofed',
        origin: 'spoofed',
        scopeWorkspaceId: 'spoofed',
        activeEntryCount: 'spoofed',
      } as never,
    })

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({
        reason: 'structural-input-root-unprojected',
        scopeWorkspaceId: 'workspace-1',
        activeEntryCount: 0,
      })
    )
  })

  /**
   * A run that failed before producing provenance hands the crossing `undefined`. That is the
   * expected shape of a failed crossing, not a guard catching something wrong, so it reports at
   * warn under its own name instead of joining the originating faults as a would-be breach.
   */
  it('separates a crossing that carried no provenance from one that was rejected', async () => {
    const absent = new ResolvedSecretTraceRegistry([], scope)
    await absent.importCrossingProvenance(undefined, 'value', {
      trusted: true,
      origin: 'someSurface.failedRunCrossing',
    })

    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'value-provenance-absent' })
    )
  })

  it('still reports a rejected crossing as a fault', async () => {
    const rejected = new ResolvedSecretTraceRegistry([], scope)
    await rejected.importCrossingProvenance({ not: 'a bundle' }, 'value', { trusted: true })

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'value-provenance-untrusted' })
    )
  })

  /**
   * A refusal is usually frames from its cause, which is what this struct exists to bridge — but it
   * carried only *what* went wrong, so a downstream reporter printed a reason with no location.
   */
  it('carries the first guard location through to the diagnostics a refusal reports', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('structural-input-root-unprojected', {
      detail: { blockType: 'table', tool: 'table_insert_row', inputPath: 'data' },
    })
    registry.markIncomplete('inherited-incomplete-source', {
      detail: { blockType: 'later', tool: 'later_tool' },
    })

    expect(registry.getIncompletenessDiagnostics()?.detail).toEqual({
      blockType: 'table',
      tool: 'table_insert_row',
      inputPath: 'data',
    })
  })

  it('names the guard that tripped rather than reporting unspecified', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.recordResolved('MISSING', 'value-not-in-catalog')

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'unverified-resolved-entry' })
    )
  })

  it('separates a tool-call scope mismatch from a merged child that was already incomplete', () => {
    const scopeMismatch = new ResolvedSecretTraceRegistry([], scope)
    const foreignChild = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-2',
    })

    scopeMismatch.mergeToolCallRegistry(foreignChild)

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'tool-call-scope-mismatch' })
    )

    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()

    const sameScope = new ResolvedSecretTraceRegistry([], scope)
    const incompleteChild = new ResolvedSecretTraceRegistry([], scope)
    incompleteChild.markIncomplete('projection-mismatch')
    mockLogger.error.mockClear()

    sameScope.mergeToolCallRegistry(incompleteChild)

    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'inherited-incomplete-source' })
    )
  })

  it('attributes an already-incomplete bundle to its source rather than to the value filter', async () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    await registry.importProvenanceForValue(
      { version: 1, complete: false, entries: [], scope },
      'x',
      {
        trusted: true,
        inputPath: ['prompt'],
      }
    )

    const reasons = mockLogger.error.mock.calls
      .concat(mockLogger.warn.mock.calls)
      .map(([, details]) => (details as { reason?: string })?.reason)
    expect(reasons).toContain('source-provenance-incomplete')
    expect(reasons).not.toContain('value-provenance-filter-incomplete')
  })

  it.each([
    'tool-input-not-enumerable',
    'tool-params-transform-failed',
    'structural-input-projection-incomplete',
    'mothership-provenance-invalid',
    'client-tool-seal-failed',
    'knowledge-row-missing',
    'knowledge-row-content-mismatch',
    'mothership-response-unreadable',
    'structural-input-root-unprojected',
    'backfill-checkpoint-unusable',
  ] as const)('reports %s at error, since it cannot trip on a healthy run', (reason) => {
    new ResolvedSecretTraceRegistry([], scope).markIncomplete(reason)

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason })
    )
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it.each([
    'mothership-provenance-missing',
    'client-tool-completion-missing',
    'client-tool-completion-deferred',
    'client-tool-completion-unidentified',
    'client-tool-execution-untrusted',
    'client-tool-content-unavailable',
    'knowledge-result-provenance-unavailable',
    'table-result-provenance-unavailable',
    'mounted-file-provenance-unavailable',
    'workspace-file-provenance-unknown',
    'file-source-unidentified',
    'mcp-tool-execution-timeout',
    'table-snapshot-unsafe-for-mount',
    'restored-provenance-untrusted',
    'backfill-checkpoint-absent',
    'client-tool-seal-absent',
  ] as const)('reports %s at warn, since it is reachable without a fault', (reason) => {
    new ResolvedSecretTraceRegistry([], scope).markIncomplete(reason)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  /**
   * The taxonomy's rule is that an error reason cannot trip on a healthy run. A backfill walking
   * historical rows hits the no-checkpoint case on essentially every legacy row, so classifying it
   * as a fault would put one error line per row into the stream this split exists to protect.
   */
  it('separates an absent checkpoint from an unusable one, so a backfill cannot flood errors', () => {
    new ResolvedSecretTraceRegistry([], scope).markIncomplete('backfill-checkpoint-absent')
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'backfill-checkpoint-absent' })
    )

    vi.clearAllMocks()
    new ResolvedSecretTraceRegistry([], scope).markIncomplete('backfill-checkpoint-unusable')
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'backfill-checkpoint-unusable' })
    )
  })

  it('does not report a log-less session at all, since it fires on every such run', () => {
    new ResolvedSecretTraceRegistry([], scope).markIncomplete('log-creation-skipped')

    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('reports an incoming incomplete bundle at warn, since no catalog was ever on offer', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('source-provenance-incomplete')

    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'source-provenance-incomplete' })
    )
  })

  it('stays silent for a registry built incomplete by design, which sits on hot paths', () => {
    createIncompleteResolvedSecretTraceRegistry(scope)

    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('keeps an unaudited caller taking the default reason out of the error stream', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('unspecified')

    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({ reason: 'unspecified' })
    )
  })

  it('reports an incoming incomplete bundle exactly once, from the registry that knows the path', async () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    await registry.importProvenanceForValue(
      { version: 1, complete: false, entries: [], scope },
      'x',
      { trusted: true, inputPath: ['prompt'] }
    )

    const records = mockLogger.error.mock.calls.concat(mockLogger.warn.mock.calls)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual([
      'Resolved secret input path marked incomplete',
      expect.objectContaining({ reason: 'source-provenance-incomplete', inputPath: 'prompt' }),
    ])
  })

  it('summarises decrypt failures once per import instead of once per entry', async () => {
    mockDecryptSecret.mockRejectedValue(new Error('key rotated'))
    const registry = new ResolvedSecretTraceRegistry([], scope)

    await registry.importProvenance(
      {
        version: 1,
        complete: true,
        entries: Array.from({ length: 25 }, (_, i) => ({
          name: `SECRET_${i}`,
          encryptedValue: `encrypted-${i}`,
        })),
        scope,
      },
      { trusted: true }
    )

    const decryptRecords = mockLogger.error.mock.calls.filter(
      ([message]) => message === 'Provenance entries could not be decrypted'
    )
    expect(decryptRecords).toHaveLength(1)
    expect(decryptRecords[0][1]).toEqual(
      expect.objectContaining({ failedEntryCount: 25, totalEntryCount: 25, error: 'key rotated' })
    )
  })

  it('reports no diagnostics while it can still vouch', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    expect(registry.getIncompletenessDiagnostics()).toBeUndefined()
  })

  it('retains the causal order of reasons, keeping the first as the originating one', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.markIncomplete('entry-decrypt-failed')
    registry.markIncomplete('source-provenance-incomplete')

    const diagnostics = registry.getIncompletenessDiagnostics()
    expect(diagnostics?.reasons[0]).toBe('entry-decrypt-failed')
    expect(diagnostics?.reasons).toEqual(['entry-decrypt-failed', 'source-provenance-incomplete'])
  })

  it('retains every distinct reason, since the reason type is what bounds the set', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    const reasons = [
      'entry-decrypt-failed',
      'source-provenance-incomplete',
      'projection-mismatch',
      'unresolved-placeholder',
      'provenance-capacity-exceeded',
      'tool-call-scope-mismatch',
      'untrusted-provenance',
      'value-provenance-untrusted',
      'value-provenance-import-failed',
      'unverified-resolved-entry',
    ] as const

    for (const reason of reasons) registry.markIncomplete(reason)

    expect(registry.getIncompletenessDiagnostics()?.reasons).toEqual([...reasons])
  })

  it('retains a by-design reason even though marking it reports nothing', () => {
    const registry = createIncompleteResolvedSecretTraceRegistry(scope)

    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(registry.getIncompletenessDiagnostics()?.reasons[0]).toBe('constructed-incomplete')
  })

  it('attributes an untrustworthy bundle to the caller that imported it', async () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    await registry.importProvenance(
      { version: 1, complete: false, entries: [], scope },
      { trusted: true, origin: 'workflowHandler.childCrossing' }
    )

    expect(registry.getIncompletenessDiagnostics()?.origins).toEqual([
      'workflowHandler.childCrossing',
    ])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Resolved secret registry marked incomplete',
      expect.objectContaining({
        reason: 'source-provenance-incomplete',
        origin: 'workflowHandler.childCrossing',
      })
    )
  })

  it('bounds retained origins, which are caller-supplied rather than a closed union', async () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    for (let index = 0; index < 20; index++) {
      await registry.importProvenance(
        { version: 1, complete: false, entries: [], scope },
        { trusted: true, origin: `caller.${index}` }
      )
    }

    expect(registry.getIncompletenessDiagnostics()?.origins).toHaveLength(8)
    expect(registry.getIncompletenessDiagnostics()?.origins[0]).toBe('caller.0')
  })

  it('records no secret material alongside the reason', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    registry.recordResolved('MISSING', 'super-secret-value')

    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain('super-secret-value')
    expect(logged).not.toContain('MISSING')
  })
})

describe('non-identifying literals in durable provenance', () => {
  /**
   * The amplifier behind the boolean redaction: once recorded on a row, every later read of that
   * table reactivated the value and rewrote every boolean in it.
   */
  it('never records a value too small to identify anything', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'BANNER_ENABLED', plaintext: 'false', encryptedValue: 'flag-ciphertext' },
      { name: 'TOKEN', plaintext: 'xoxb-real-secret-value', encryptedValue: 'token-ciphertext' },
    ])
    registry.recordResolved('BANNER_ENABLED', 'false')
    registry.recordResolved('TOKEN', 'xoxb-real-secret-value')

    expect(registry.exportProvenanceForValue({ had_error: false, note: 'fromUser=false' })).toEqual(
      { version: 1, complete: true, entries: [] }
    )
    expect(registry.exportProvenanceForValue({ token: 'xoxb-real-secret-value' })).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'token-ciphertext' }],
    })
  })

  it('still recognizes the internal alias, which names the variable its value cannot', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'BANNER_ENABLED', plaintext: 'false', encryptedValue: 'flag-ciphertext' },
    ])
    registry.recordResolved('BANNER_ENABLED', 'false')

    expect(registry.exportProvenanceForValue({ code: '__var_BANNER_ENABLED' })).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'BANNER_ENABLED', encryptedValue: 'flag-ciphertext' }],
    })
  })

  it('keeps it out of the model matcher so nothing downstream can substitute it', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'BANNER_ENABLED', plaintext: 'false', encryptedValue: 'flag-ciphertext' },
    ])
    registry.recordResolved('BANNER_ENABLED', 'false')

    const snapshot = registry.getModelEgressSnapshot()
    expect(snapshot.complete).toBe(true)
    if (snapshot.complete) {
      expect(snapshot.matches.map((match) => match.plaintext)).not.toContain('false')
    }
  })
})

describe('unredacted catalog exemption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `decrypted:${encryptedValue}`,
    }))
  })

  it('drops an exempt workspace secret from trace and model matches but keeps usage', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: { STAGING_KEY: 'staging-encrypted' },
      personalDecrypted: {},
      workspaceDecrypted: { STAGING_KEY: 'staging-value-123' },
      workspaceUnredactedKeys: ['STAGING_KEY'],
    })

    expect(registry.recordResolved('STAGING_KEY', 'staging-value-123')).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])

    const snapshot = registry.getModelEgressSnapshot()
    expect(snapshot.complete).toBe(true)
    if (snapshot.complete) {
      /** The legacy alias still substitutes; the value and its JSON encoding do not. */
      expect(snapshot.matches).toEqual([
        { plaintext: '__var_STAGING_KEY', replacement: '{{STAGING_KEY}}' },
      ])
    }

    expect(registry.getResolvedSecretUsage()).toEqual([
      { name: 'STAGING_KEY', scope: 'workspace', ownerUserId: null },
    ])
  })

  it('never stamps a personal secret, even when its name is listed', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { PERSONAL_KEY: 'personal-encrypted' },
      workspaceEncrypted: {},
      personalDecrypted: { PERSONAL_KEY: 'personal-value-123' },
      workspaceDecrypted: {},
      personalOwners: { PERSONAL_KEY: 'owner-1' },
      workspaceUnredactedKeys: ['PERSONAL_KEY'],
    })

    expect(registry.recordResolved('PERSONAL_KEY', 'personal-value-123')).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'personal-value-123', replacement: '{{PERSONAL_KEY}}' },
    ])
  })

  it('exempts only the workspace value when it shadows a same-named personal secret', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { SHARED: 'personal-encrypted' },
      workspaceEncrypted: { SHARED: 'workspace-encrypted' },
      personalDecrypted: { SHARED: 'personal-value-123' },
      workspaceDecrypted: { SHARED: 'workspace-value-123' },
      workspaceUnredactedKeys: ['SHARED'],
    })

    expect(registry.recordResolved('SHARED', 'workspace-value-123')).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
    expect(registry.exportProvenance()).toEqual({ version: 1, complete: true, entries: [] })
  })

  it('keeps redacting a plaintext an exempt and a non-exempt secret share', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { OTHER_KEY: 'other-encrypted' },
      workspaceEncrypted: { EXEMPT_KEY: 'exempt-encrypted' },
      personalDecrypted: { OTHER_KEY: 'shared-value-123' },
      workspaceDecrypted: { EXEMPT_KEY: 'shared-value-123' },
      personalOwners: { OTHER_KEY: 'owner-1' },
      workspaceUnredactedKeys: ['EXEMPT_KEY'],
    })

    expect(registry.recordResolved('EXEMPT_KEY', 'shared-value-123')).toBe(true)
    expect(registry.recordResolved('OTHER_KEY', 'shared-value-123')).toBe(true)

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'shared-value-123', replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT },
    ])
    expect(registry.exportProvenanceForValue('payload shared-value-123').entries).toEqual([
      { name: 'EXEMPT_KEY', encryptedValue: 'exempt-encrypted' },
      { name: 'OTHER_KEY', encryptedValue: 'other-encrypted' },
    ])
  })

  it('omits a solely-exempt entry from every envelope while staying complete', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: { STAGING_KEY: 'staging-encrypted' },
      personalDecrypted: {},
      workspaceDecrypted: { STAGING_KEY: 'staging-value-123' },
      workspaceUnredactedKeys: ['STAGING_KEY'],
    })

    expect(
      registry.recordResolvedAtInputPath('STAGING_KEY', 'staging-value-123', ['params', 'apiKey'])
    ).toBe(true)

    expect(registry.exportProvenance()).toEqual({ version: 1, complete: true, entries: [] })
    expect(registry.exportCheckpointProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
    expect(registry.exportCommittedProvenanceForValue('body staging-value-123')).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
    expect(registry.exportCommittedProvenanceForInputPaths([['params', 'apiKey']])).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
  })

  it('keeps an exempt entry, anonymized, in a forced-anonymous crossing envelope', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: { STAGING_KEY: 'staging-encrypted' },
      personalDecrypted: {},
      workspaceDecrypted: { STAGING_KEY: 'staging-value-123' },
      workspaceUnredactedKeys: ['STAGING_KEY'],
    })

    expect(registry.recordResolved('STAGING_KEY', 'staging-value-123')).toBe(true)
    expect(
      registry.exportCommittedProvenanceForValue('body staging-value-123', { anonymous: true })
    ).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'staging-encrypted' }],
    })
  })

  it('a fork keeps protecting a collider left behind in the parent', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { OTHER_KEY: 'other-encrypted' },
      workspaceEncrypted: { EXEMPT_KEY: 'exempt-encrypted' },
      personalDecrypted: { OTHER_KEY: 'shared-value-123' },
      workspaceDecrypted: { EXEMPT_KEY: 'shared-value-123' },
      personalOwners: { OTHER_KEY: 'owner-1' },
      workspaceUnredactedKeys: ['EXEMPT_KEY'],
    })

    expect(
      registry.recordResolvedAtInputPath('EXEMPT_KEY', 'shared-value-123', ['params', 'apiKey'])
    ).toBe(true)
    expect(registry.recordResolved('OTHER_KEY', 'shared-value-123')).toBe(true)

    const fork = registry.forkForInputPaths([['params', 'apiKey']])
    expect(fork.getActiveMatches()).toEqual([
      { plaintext: 'shared-value-123', replacement: '{{EXEMPT_KEY}}' },
    ])
    expect(fork.exportProvenanceForValue('shared-value-123').entries).toEqual([
      { name: 'EXEMPT_KEY', encryptedValue: 'exempt-encrypted' },
    ])
  })

  it('exempts an imported duplicate only on an exact name and value match', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: { EXEMPT_KEY: 'exempt-encrypted' },
      personalDecrypted: {},
      workspaceDecrypted: { EXEMPT_KEY: 'decrypted:exempt-encrypted' },
      workspaceUnredactedKeys: ['EXEMPT_KEY'],
    })

    await registry.importProvenance(
      {
        version: 1,
        complete: true,
        entries: [{ name: 'EXEMPT_KEY', encryptedValue: 'exempt-encrypted' }],
      },
      { trusted: true }
    )
    expect(registry.getActiveMatches()).toEqual([])

    await registry.importProvenance(
      {
        version: 1,
        complete: true,
        entries: [{ name: 'EXEMPT_KEY', encryptedValue: 'rotated-encrypted' }],
      },
      { trusted: true }
    )
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'decrypted:rotated-encrypted', replacement: '{{EXEMPT_KEY}}' },
    ])
  })

  it('never bypasses fail-closed incompleteness', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: { STAGING_KEY: 'staging-encrypted' },
      personalDecrypted: {},
      workspaceDecrypted: { STAGING_KEY: 'staging-value-123' },
      workspaceUnredactedKeys: ['STAGING_KEY'],
    })

    registry.markIncomplete('unspecified')
    expect(registry.getModelEgressSnapshot()).toEqual({ complete: false })
    expect(registry.exportProvenance().complete).toBe(false)
    /** A missing collider is indistinguishable from none — certify nothing once latched. */
    expect(registry.getUnredactedSecretNames()).toEqual([])
  })

  it('releases an exempt-only recorded input leaf to the model raw', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: { STAGING_KEY: 'staging-encrypted' },
      personalDecrypted: {},
      workspaceDecrypted: { STAGING_KEY: 'staging-value-123' },
      workspaceUnredactedKeys: ['STAGING_KEY'],
    })

    expect(
      registry.recordResolvedAtInputPath('STAGING_KEY', 'staging-value-123', ['params', 'apiKey'])
    ).toBe(true)
    registry.recordResolvedInputProjection(
      ['params', 'apiKey'],
      'staging-value-123',
      '{{STAGING_KEY}}'
    )

    expect(
      registry.projectResolvedInputSelection({ params: { apiKey: 'staging-value-123' } })
    ).toEqual({
      complete: true,
      value: { params: { apiKey: 'staging-value-123' } },
    })
  })

  it('keeps projecting an input leaf whose plaintext a protected secret shares', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { OTHER_KEY: 'other-encrypted' },
      workspaceEncrypted: { EXEMPT_KEY: 'exempt-encrypted' },
      personalDecrypted: { OTHER_KEY: 'shared-value-123' },
      workspaceDecrypted: { EXEMPT_KEY: 'shared-value-123' },
      personalOwners: { OTHER_KEY: 'owner-1' },
      workspaceUnredactedKeys: ['EXEMPT_KEY'],
    })

    expect(
      registry.recordResolvedAtInputPath('EXEMPT_KEY', 'shared-value-123', ['params', 'apiKey'])
    ).toBe(true)
    expect(registry.recordResolved('OTHER_KEY', 'shared-value-123')).toBe(true)
    registry.recordResolvedInputProjection(
      ['params', 'apiKey'],
      'shared-value-123',
      '{{EXEMPT_KEY}}'
    )

    expect(
      registry.projectResolvedInputSelection({ params: { apiKey: 'shared-value-123' } })
    ).toEqual({
      complete: true,
      value: { params: { apiKey: '{{EXEMPT_KEY}}' } },
    })
  })

  it('certifies only collision-free exempt names for the sandbox path', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { OTHER_KEY: 'other-encrypted' },
      workspaceEncrypted: { EXEMPT_KEY: 'exempt-encrypted', CLEAN_KEY: 'clean-encrypted' },
      personalDecrypted: { OTHER_KEY: 'shared-value-123' },
      workspaceDecrypted: {
        EXEMPT_KEY: 'shared-value-123',
        CLEAN_KEY: 'clean-value-456',
      },
      personalOwners: { OTHER_KEY: 'owner-1' },
      workspaceUnredactedKeys: ['EXEMPT_KEY', 'CLEAN_KEY'],
    })

    expect(registry.getUnredactedSecretNames()).toEqual(['CLEAN_KEY'])

    /** An anonymous entry activated mid-run withdraws the certification too. */
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted:
        encryptedValue === 'anon-encrypted' ? 'clean-value-456' : `decrypted:${encryptedValue}`,
    }))
    await registry.importProvenance(
      { version: 1, complete: true, entries: [{ encryptedValue: 'anon-encrypted' }] },
      { trusted: true, anonymous: true }
    )
    expect(registry.getUnredactedSecretNames()).toEqual([])
  })
})
