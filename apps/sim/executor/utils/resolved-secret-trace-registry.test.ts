import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import {
  ANONYMOUS_SECRET_TRACE_REPLACEMENT,
  createResolvedSecretTraceRegistry,
  isResolvedSecretProvenanceAbsence,
  isResolvedSecretTraceProvenanceV1,
  RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION,
  ResolvedSecretTraceProvenanceAccumulator,
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const mockDecryptSecret = encryptionMockFns.mockDecryptSecret
const mockLogger = getMockLogger('ResolvedSecretTraceRegistry')

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
})

describe('ResolvedSecretTraceRegistry', () => {
  beforeEach(() => {
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

describe('current environment resolutions', () => {
  const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
  const oldEntry = {
    name: 'API_KEY',
    plaintext: 'old-personal-secret',
    encryptedValue: 'encrypted-old',
    scope: 'personal' as const,
    ownerUserId: scope.userId,
  }
  const environment = {
    personalEncrypted: { API_KEY: oldEntry.encryptedValue },
    personalDecrypted: { API_KEY: oldEntry.plaintext },
    personalOwners: { API_KEY: scope.userId },
    workspaceEncrypted: { API_KEY: 'encrypted-current', UNRELATED: 'encrypted-unrelated' },
    workspaceDecrypted: { API_KEY: 'current-workspace-secret', UNRELATED: 'unrelated-secret' },
    scope,
  }

  it('uses the current workspace value while preserving earlier active values and sibling snapshots', () => {
    const parent = new ResolvedSecretTraceRegistry([oldEntry], scope)
    parent.recordResolved(oldEntry.name, oldEntry.plaintext, { propagated: true })
    const sibling = parent.forkForInputPaths([])
    const current = parent.forkForToolCall()

    expect(
      current.recordResolvedFromEnvironment('API_KEY', 'current-workspace-secret', environment, {
        path: ['apiKey'],
        propagated: true,
      })
    ).toBe(true)
    expect(current.isComplete()).toBe(true)
    expect(current.getActiveMatches()).toEqual(
      expect.arrayContaining([
        { plaintext: oldEntry.plaintext, replacement: '{{API_KEY}}' },
        { plaintext: 'current-workspace-secret', replacement: '{{API_KEY}}' },
      ])
    )
    expect(current.getResolvedSecretUsage()).toEqual(
      expect.arrayContaining([
        { name: 'API_KEY', scope: 'personal', ownerUserId: scope.userId },
        { name: 'API_KEY', scope: 'workspace', ownerUserId: null },
      ])
    )
    expect(sibling.recordResolved('API_KEY', oldEntry.plaintext)).toBe(true)
    expect(sibling.isComplete()).toBe(true)
    expect(parent.getActiveMatches()).toEqual([
      { plaintext: oldEntry.plaintext, replacement: '{{API_KEY}}' },
    ])
    parent.mergeToolCallRegistry(current)
    expect(parent.getActiveMatches()).toEqual(current.getActiveMatches())
    expect(current.recordResolved('UNRELATED', 'unrelated-secret')).toBe(false)
  })

  it('rejects a removed secret instead of vouching from the old catalog', () => {
    const registry = new ResolvedSecretTraceRegistry([oldEntry], scope)
    registry.recordResolved(oldEntry.name, oldEntry.plaintext, { propagated: true })

    expect(
      registry.recordResolvedFromEnvironment(oldEntry.name, oldEntry.plaintext, {
        personalEncrypted: {},
        personalDecrypted: {},
        workspaceEncrypted: {},
        workspaceDecrypted: {},
        scope,
      })
    ).toBe(false)
    expect(registry.isComplete()).toBe(false)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: oldEntry.plaintext, replacement: '{{API_KEY}}' },
    ])
  })

  it.each([
    { userId: 'another-user', workspaceId: scope.workspaceId },
    { userId: scope.userId, workspaceId: 'another-workspace' },
  ])('rejects a snapshot from a different scope: %j', (otherScope) => {
    const registry = new ResolvedSecretTraceRegistry([], scope)

    expect(
      registry.recordResolvedFromEnvironment('API_KEY', 'current-workspace-secret', {
        ...environment,
        scope: otherScope,
      })
    ).toBe(false)
    expect(registry.isComplete()).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
  })
})
