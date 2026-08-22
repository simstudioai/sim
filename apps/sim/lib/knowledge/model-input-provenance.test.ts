/**
 * @vitest-environment node
 */
import { encryptionMockFns, environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { internalKnowledgeSearchBodySchema } from '@/lib/api/contracts/knowledge/search'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  prepareKnowledgeModelInputProvenance,
  projectKnowledgeModelInput,
  runWithKnowledgeModelInputProvenance,
} from '@/lib/knowledge/model-input-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: encryptionMockFns.mockDecryptSecret,
}))

function verifiedHeaders(): Headers {
  return new Headers({
    [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  })
}

function verifiedPayload(): Record<string, unknown> {
  return {
    query: 'safe query',
    [RESOLVED_SECRET_PROVENANCE_FIELD]: {
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    },
  }
}

describe('Knowledge model input provenance', () => {
  afterEach(() => {
    resetEnvironmentUtilsMock()
    encryptionMockFns.mockDecryptSecret.mockReset()
  })

  it('preserves headerless legacy calls without loading an environment catalog', async () => {
    const result = await prepareKnowledgeModelInputProvenance({
      headers: new Headers(),
      payload: { query: 'legacy query' },
      isInternalRequest: false,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      modelInput: 'legacy query',
    })

    expect(result).toEqual({ success: true })
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })

  it('preserves a headerless internal legacy call without loading an environment catalog', async () => {
    const result = await prepareKnowledgeModelInputProvenance({
      headers: new Headers(),
      payload: { query: 'missing provenance' },
      isInternalRequest: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      modelInput: 'missing provenance',
    })

    expect(result).toEqual({ success: true })
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })

  it('accepts a complete empty envelope without loading secrets that cannot affect the call', async () => {
    const result = await prepareKnowledgeModelInputProvenance({
      headers: verifiedHeaders(),
      payload: verifiedPayload(),
      isInternalRequest: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      modelInput: 'safe query',
    })

    expect(result.success).toBe(true)
    expect(result.success && result.registry?.isComplete()).toBe(true)
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })

  it('accepts a verified envelope after the internal route contract parses it', async () => {
    const body = internalKnowledgeSearchBodySchema.parse({
      knowledgeBaseIds: ['knowledge-base-1'],
      ...verifiedPayload(),
    })

    const result = await prepareKnowledgeModelInputProvenance({
      headers: verifiedHeaders(),
      payload: body,
      isInternalRequest: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      modelInput: body.query,
    })

    expect(result.success).toBe(true)
    expect(result.success && result.registry?.isComplete()).toBe(true)
  })

  it('does not activate an authenticated entry absent from the exact model input', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: { TOKEN: 'encrypted-token' },
      workspaceEncrypted: {},
      personalDecrypted: { TOKEN: 'secret-value' },
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
    const payload = {
      query: 'derived model input',
      [RESOLVED_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    }

    const result = await prepareKnowledgeModelInputProvenance({
      headers: verifiedHeaders(),
      payload,
      isInternalRequest: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      modelInput: 'derived model input',
    })

    expect(result.success).toBe(true)
    expect(result.success && result.registry?.getActiveMatches()).toEqual([])
  })

  it('activates an authenticated entry present in the exact model input', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: { TOKEN: 'encrypted-token' },
      workspaceEncrypted: {},
      personalDecrypted: { TOKEN: 'secret-value' },
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
    const payload = {
      query: 'query with secret-value',
      [RESOLVED_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    }

    const result = await prepareKnowledgeModelInputProvenance({
      headers: verifiedHeaders(),
      payload,
      isInternalRequest: true,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      modelInput: payload.query,
    })

    expect(result.success).toBe(true)
    expect(result.success && result.registry?.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{TOKEN}}' },
    ])
  })

  it('rejects private metadata from a session caller and every partial envelope', async () => {
    await expect(
      prepareKnowledgeModelInputProvenance({
        headers: verifiedHeaders(),
        payload: verifiedPayload(),
        isInternalRequest: false,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        modelInput: 'safe query',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid model input provenance',
      status: 400,
    })

    await expect(
      prepareKnowledgeModelInputProvenance({
        headers: new Headers(),
        payload: verifiedPayload(),
        isInternalRequest: true,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        modelInput: 'safe query',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid model input provenance',
      status: 400,
    })
  })

  it('projects exact active values only inside the matching asynchronous context', async () => {
    const first = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: 'first-secret', encryptedValue: 'encrypted-first' },
    ])
    const second = new ResolvedSecretTraceRegistry([
      { name: 'SECOND', plaintext: 'second-secret', encryptedValue: 'encrypted-second' },
    ])
    first.recordResolved('FIRST', 'first-secret')
    second.recordResolved('SECOND', 'second-secret')

    const [firstResult, secondResult] = await Promise.all([
      runWithKnowledgeModelInputProvenance(first, async () => {
        await Promise.resolve()
        return projectKnowledgeModelInput('first-secret second-secret')
      }),
      runWithKnowledgeModelInputProvenance(second, async () => {
        await Promise.resolve()
        return projectKnowledgeModelInput('first-secret second-secret')
      }),
    ])

    expect(firstResult).toBe('{{FIRST}} second-secret')
    expect(secondResult).toBe('first-secret {{SECOND}}')
    expect(projectKnowledgeModelInput('first-secret second-secret')).toBe(
      'first-secret second-secret'
    )
  })

  it('fails before model egress when an active request registry is incomplete', () => {
    const registry = new ResolvedSecretTraceRegistry([])
    registry.markIncomplete('unspecified')

    expect(() =>
      runWithKnowledgeModelInputProvenance(registry, () =>
        projectKnowledgeModelInput('model input')
      )
    ).toThrow('Knowledge model input could not be safely projected')
  })
})
