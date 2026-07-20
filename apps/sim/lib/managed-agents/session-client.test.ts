/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildSessionCreatePayload } from '@/lib/managed-agents/session-client'

const BASE = {
  apiKey: 'sk-ant-fake',
  agentId: 'agent_01ABC',
  environmentId: 'env_01XYZ',
} as const

describe('buildSessionCreatePayload — always-on fields', () => {
  it('emits `agent` and `environment_id` from the input', () => {
    expect(buildSessionCreatePayload({ ...BASE })).toEqual({
      agent: 'agent_01ABC',
      environment_id: 'env_01XYZ',
    })
  })

  it('emits `title` when set', () => {
    expect(buildSessionCreatePayload({ ...BASE, title: 'my session' }).title).toBe('my session')
  })

  it('emits `vault_ids` only when non-empty', () => {
    expect(buildSessionCreatePayload({ ...BASE }).vault_ids).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, vaultIds: [] }).vault_ids).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, vaultIds: ['vlt_1', 'vlt_2'] }).vault_ids).toEqual([
      'vlt_1',
      'vlt_2',
    ])
  })
})

describe('buildSessionCreatePayload — resources', () => {
  it('attaches a memory store as a `memory_store` resource with default access', () => {
    const payload = buildSessionCreatePayload({ ...BASE, memoryStoreId: 'memstore_01' })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
    ])
  })

  it('honors explicit read_only memory access', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      memoryAccess: 'read_only',
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_only' },
    ])
  })

  it('attaches file resources by id (no mount path)', () => {
    const payload = buildSessionCreatePayload({ ...BASE, fileIds: ['file_1', 'file_2'] })
    expect(payload.resources).toEqual([
      { type: 'file', file_id: 'file_1' },
      { type: 'file', file_id: 'file_2' },
    ])
  })

  it('combines memory and file resources in order', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      fileIds: ['file_1'],
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
      { type: 'file', file_id: 'file_1' },
    ])
  })

  it('omits `resources` when nothing is attached', () => {
    expect(buildSessionCreatePayload({ ...BASE }).resources).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, fileIds: [] }).resources).toBeUndefined()
  })
})

describe('buildSessionCreatePayload — metadata', () => {
  it('emits `metadata` from sessionParameters', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      sessionParameters: { foo: 'bar', baz: 'qux' },
    })
    expect(payload.metadata).toEqual({ foo: 'bar', baz: 'qux' })
  })

  it('omits `metadata` when there are no session parameters', () => {
    expect(buildSessionCreatePayload({ ...BASE }).metadata).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, sessionParameters: {} }).metadata).toBeUndefined()
  })

  it('keeps memory on resources and never folds it into metadata', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      sessionParameters: { env: 'staging' },
    })
    expect(payload.metadata).toEqual({ env: 'staging' })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
    ])
  })
})
