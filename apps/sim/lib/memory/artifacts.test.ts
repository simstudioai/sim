/**
 * @vitest-environment node
 */
import { memory, memoryArtifact } from '@sim/db/schema'
import { dbChainMockFns, encryptionMock, encryptionMockFns, resetDbChainMock } from '@sim/testing'
import { eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { getMemoryArtifactHandle } from '@/lib/memory/artifact-handle'

const { storeLargeValue, materializeLargeValueRef } = vi.hoisted(() => ({
  storeLargeValue: vi.fn(),
  materializeLargeValueRef: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/execution/payloads/store', () => ({ storeLargeValue, materializeLargeValueRef }))

import {
  MAX_MEMORY_ARTIFACT_BYTES,
  MAX_MEMORY_ARTIFACT_STORED_BYTES,
  readMemoryArtifact,
  readMemoryArtifactByHandle,
  storeMemoryArtifact,
} from '@/lib/memory/artifacts'

const scope = { workspaceId: 'workspace-1', memoryId: 'memory-1' }
const identity = {
  ...scope,
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  attributedUserId: 'user-1',
}
const ref: LargeValueRef = {
  __simLargeValueRef: true,
  version: 1,
  id: 'lv_abcdefghijkl',
  kind: 'object',
  size: 100,
  executionId: identity.executionId,
  key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
}

describe('encrypted memory artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    storeLargeValue.mockResolvedValue(ref)
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: '{"success":true}' })
    materializeLargeValueRef.mockResolvedValue({ version: 1, encrypted: 'ciphertext' })
  })

  it('stores ciphertext only, attaches it to an active memory, and returns a safe preview', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: scope.memoryId }])
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: scope.memoryId }])
    const value = { modelResponse: { output: 'visible' }, rawResponse: { private: 'secret-value' } }

    const artifact = await storeMemoryArtifact({ ...identity, value })

    expect(encryptionMockFns.mockEncryptSecret).toHaveBeenCalledWith(JSON.stringify(value))
    expect(storeLargeValue).toHaveBeenCalledWith(
      { version: 1, encrypted: 'ciphertext' },
      '{"version":1,"encrypted":"ciphertext"}',
      expect.any(Number),
      {
        workspaceId: identity.workspaceId,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
        userId: identity.attributedUserId,
        requireDurable: true,
      }
    )
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(memoryArtifact)
    expect(dbChainMockFns.values).toHaveBeenCalledWith({ memoryId: scope.memoryId, key: ref.key })
    expect(artifact?.ref.key).toBe(ref.key)
    expect(JSON.stringify(artifact)).not.toContain('secret-value')
    expect(artifact?.preview).toBe(artifact?.ref.preview)
  })

  it('preserves ownership of nested large-value payloads hidden by encryption', async () => {
    const childRef = {
      ...ref,
      id: 'lv_mnopqrstuvwx',
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_mnopqrstuvwx.json',
    }
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: scope.memoryId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: scope.memoryId }])

    await storeMemoryArtifact({ ...identity, value: { output: childRef } })

    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      { parentKey: ref.key, childKey: childRef.key, workspaceId: scope.workspaceId },
    ])
  })

  it('does not create an artifact for a missing or deleted memory', async () => {
    expect(await storeMemoryArtifact({ ...identity, value: 'data' })).toBeUndefined()
    expect(storeLargeValue).not.toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith(memory.workspaceId, scope.workspaceId)
    expect(eq).toHaveBeenCalledWith(memory.id, scope.memoryId)
    expect(isNull).toHaveBeenCalledWith(memory.deletedAt)
  })

  it('does not resurrect a memory deleted while its object is being uploaded', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: scope.memoryId }]).mockResolvedValueOnce([])
    expect(await storeMemoryArtifact({ ...identity, value: 'data' })).toBeUndefined()
    expect(storeLargeValue).toHaveBeenCalledOnce()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects oversized strings, excessive nodes, cycles, and deep values before storage', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deep: unknown = 'leaf'
    for (let index = 0; index < 66; index++) deep = { child: deep }
    for (const value of ['x'.repeat(MAX_MEMORY_ARTIFACT_BYTES + 1), Array(100_001), cyclic, deep]) {
      expect(await storeMemoryArtifact({ ...identity, value })).toBeUndefined()
    }
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    expect(storeLargeValue).not.toHaveBeenCalled()
  })

  it('does not invoke getters or custom JSON serialization while checking a result', async () => {
    const read = vi.fn(() => 'secret')
    const getterValue = Object.defineProperty({}, 'field', { enumerable: true, get: read })
    const toJSON = vi.fn(() => 'secret')
    const custom = Object.defineProperty({}, 'toJSON', { value: toJSON })
    expect(await storeMemoryArtifact({ ...identity, value: getterValue })).toBeUndefined()
    expect(await storeMemoryArtifact({ ...identity, value: custom })).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('checks exact memory ownership before materializing or decrypting', async () => {
    expect(await readMemoryArtifact({ ...scope, ref })).toBeUndefined()
    expect(eq).toHaveBeenCalledWith(memory.id, scope.memoryId)
    expect(eq).toHaveBeenCalledWith(memory.workspaceId, scope.workspaceId)
    expect(eq).toHaveBeenCalledWith(memoryArtifact.key, ref.key)
    expect(materializeLargeValueRef).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('rejects model-supplied storage keys without querying or downloading', async () => {
    expect(await readMemoryArtifactByHandle({ ...scope, artifactId: ref.key! })).toBeUndefined()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(materializeLargeValueRef).not.toHaveBeenCalled()
  })

  it('conceals a handle owned by another or deleted memory before storage access', async () => {
    const artifactId = getMemoryArtifactHandle(ref.key!)
    expect(artifactId).toMatch(/^[a-f0-9]{64}$/)
    expect(artifactId).not.toContain('execution')
    expect(await readMemoryArtifactByHandle({ ...scope, artifactId })).toBeUndefined()
    expect(eq).toHaveBeenCalledWith(memory.id, scope.memoryId)
    expect(eq).toHaveBeenCalledWith(memory.workspaceId, scope.workspaceId)
    expect(isNull).toHaveBeenCalledWith(memory.deletedAt)
    expect(materializeLargeValueRef).not.toHaveBeenCalled()
  })

  it('resolves an opaque handle using its canonical owned key and metadata', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ key: ref.key }]).mockResolvedValueOnce([
      {
        key: ref.key,
        size: 500,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
      },
    ])
    expect(
      await readMemoryArtifactByHandle({ ...scope, artifactId: getMemoryArtifactHandle(ref.key!) })
    ).toEqual({ success: true })
    expect(materializeLargeValueRef).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ref.id,
        key: ref.key,
        size: 500,
        executionId: identity.executionId,
      }),
      expect.objectContaining({
        workspaceId: scope.workspaceId,
        maxBytes: MAX_MEMORY_ARTIFACT_STORED_BYTES,
      })
    )
  })

  it('uses canonical size and execution metadata and bounds the encrypted download', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: ref.key,
        size: 500,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
      },
    ])
    expect(await readMemoryArtifact({ ...scope, ref: { ...ref, size: 1 } })).toEqual({
      success: true,
    })
    expect(materializeLargeValueRef).toHaveBeenCalledWith(
      { ...ref, size: 500 },
      {
        workspaceId: identity.workspaceId,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
        maxBytes: MAX_MEMORY_ARTIFACT_STORED_BYTES,
        trackReference: false,
      }
    )
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledWith('ciphertext', {
      logFailure: false,
    })
  })

  it('keeps memory-owned artifacts readable after their source workflow is deleted', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { key: ref.key, size: 500, workflowId: null, executionId: identity.executionId },
    ])
    expect(await readMemoryArtifact({ ...scope, ref })).toEqual({ success: true })
    expect(materializeLargeValueRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workflowId: identity.workflowId })
    )
  })

  it('rejects canonical payloads above the download budget before loading them', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: ref.key,
        size: MAX_MEMORY_ARTIFACT_STORED_BYTES + 1,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
      },
    ])
    expect(await readMemoryArtifact({ ...scope, ref })).toBeUndefined()
    expect(materializeLargeValueRef).not.toHaveBeenCalled()
  })

  it('preserves the shared materializer unavailable-result contract without attempting decryption', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: ref.key,
        size: 500,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
      },
    ])
    materializeLargeValueRef.mockResolvedValueOnce(undefined)
    expect(await readMemoryArtifact({ ...scope, ref })).toBeUndefined()
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('does not swallow errors that escape the materialization boundary', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: ref.key,
        size: 500,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
      },
    ])
    const error = new Error('Materialization access check failed')
    materializeLargeValueRef.mockRejectedValueOnce(error)
    await expect(readMemoryArtifact({ ...scope, ref })).rejects.toBe(error)
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it.each(['ciphertext', 'json'])(
    'treats corrupt %s as an unavailable artifact',
    async (failure) => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        {
          key: ref.key,
          size: 500,
          workflowId: identity.workflowId,
          executionId: identity.executionId,
        },
      ])
      if (failure === 'ciphertext')
        encryptionMockFns.mockDecryptSecret.mockRejectedValueOnce(new Error('invalid ciphertext'))
      else encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'invalid JSON' })
      expect(await readMemoryArtifact({ ...scope, ref })).toBeUndefined()
    }
  )

  it('rejects an oversized decrypted result before parsing it', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        key: ref.key,
        size: 500,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
      },
    ])
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: 'x'.repeat(MAX_MEMORY_ARTIFACT_BYTES + 1),
    })
    expect(await readMemoryArtifact({ ...scope, ref })).toBeUndefined()
  })
})
