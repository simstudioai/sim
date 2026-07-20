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
    const payload = buildSessionCreatePayload({ ...BASE })
    expect(payload).toEqual({ agent: 'agent_01ABC', environment_id: 'env_01XYZ' })
  })

  it('emits `title` when set', () => {
    const payload = buildSessionCreatePayload({ ...BASE, title: 'my session' })
    expect(payload.title).toBe('my session')
  })

  it('emits `vault_ids` only when non-empty', () => {
    const withNone = buildSessionCreatePayload({ ...BASE })
    expect(withNone.vault_ids).toBeUndefined()

    const withEmptyArray = buildSessionCreatePayload({ ...BASE, vaultIds: [] })
    expect(withEmptyArray.vault_ids).toBeUndefined()

    const withVaults = buildSessionCreatePayload({
      ...BASE,
      vaultIds: ['vlt_1', 'vlt_2'],
    })
    expect(withVaults.vault_ids).toEqual(['vlt_1', 'vlt_2'])
  })
})

describe('buildSessionCreatePayload — cloud env', () => {
  it('attaches memory store as a `memory_store` resource with default access', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'cloud',
      memoryStoreId: 'memstore_01',
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
    ])
    // Cloud must NOT fold memory into metadata.
    expect(payload.metadata).toBeUndefined()
  })

  it('honors explicit read_only memory access', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'cloud',
      memoryStoreId: 'memstore_01',
      memoryAccess: 'read_only',
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_only' },
    ])
  })

  it('attaches file resources with an optional mount_path', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'cloud',
      files: [
        { fileId: 'file_1', mountPath: '/data/one' },
        { fileId: 'file_2' },
      ],
    })
    expect(payload.resources).toEqual([
      { type: 'file', file_id: 'file_1', mount_path: '/data/one' },
      { type: 'file', file_id: 'file_2' },
    ])
  })

  it('drops file entries missing a fileId', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'cloud',
      files: [{ fileId: '' }, { fileId: 'file_ok' }],
    })
    expect(payload.resources).toEqual([{ type: 'file', file_id: 'file_ok' }])
  })

  it('emits `metadata` from sessionParameters as opaque tags', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'cloud',
      sessionParameters: { foo: 'bar', baz: 'qux' },
    })
    expect(payload.metadata).toEqual({ foo: 'bar', baz: 'qux' })
    expect(payload.resources).toBeUndefined()
  })

  it('emits neither resources nor metadata when the caller supplies nothing', () => {
    const payload = buildSessionCreatePayload({ ...BASE, envType: 'cloud' })
    expect(payload.resources).toBeUndefined()
    expect(payload.metadata).toBeUndefined()
  })

  it('emits both resources[] and metadata when both are set', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'cloud',
      memoryStoreId: 'memstore_01',
      files: [{ fileId: 'file_1' }],
      sessionParameters: { env: 'staging' },
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
      { type: 'file', file_id: 'file_1' },
    ])
    expect(payload.metadata).toEqual({ env: 'staging' })
  })
})

describe('buildSessionCreatePayload — self-hosted env', () => {
  it('folds memory into metadata (never onto resources)', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'self_hosted',
      memoryStoreId: 'memstore_01',
    })
    expect(payload.resources).toBeUndefined()
    expect(payload.metadata).toEqual({
      memory_store_ids: 'memstore_01',
      memory_access: 'read_write',
    })
  })

  it('honors explicit read_only memory access when folded into metadata', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'self_hosted',
      memoryStoreId: 'memstore_01',
      memoryAccess: 'read_only',
    })
    expect(payload.metadata).toEqual({
      memory_store_ids: 'memstore_01',
      memory_access: 'read_only',
    })
  })

  it('merges user-supplied sessionParameters with memory metadata', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'self_hosted',
      memoryStoreId: 'memstore_01',
      sessionParameters: { SOURCE_URL: 'https://example/repo.git' },
    })
    expect(payload.metadata).toEqual({
      SOURCE_URL: 'https://example/repo.git',
      memory_store_ids: 'memstore_01',
      memory_access: 'read_write',
    })
  })

  it('does not overwrite a user-supplied memory_store_ids key', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'self_hosted',
      memoryStoreId: 'memstore_A',
      sessionParameters: { memory_store_ids: 'memstore_B' },
    })
    expect(payload.metadata).toEqual({ memory_store_ids: 'memstore_B' })
  })

  it('never emits `resources` — even when files are supplied', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      envType: 'self_hosted',
      memoryStoreId: 'memstore_01',
      files: [{ fileId: 'file_1', mountPath: '/dropped' }],
      sessionParameters: { A: '1' },
    })
    expect(payload.resources).toBeUndefined()
  })

  it('omits metadata when nothing memory- or param-related is set', () => {
    const payload = buildSessionCreatePayload({ ...BASE, envType: 'self_hosted' })
    expect(payload.metadata).toBeUndefined()
    expect(payload.resources).toBeUndefined()
  })
})

describe('buildSessionCreatePayload — envType default (no route branch)', () => {
  it('defaults to the cloud shape when envType is omitted', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
    ])
    expect(payload.metadata).toBeUndefined()
  })
})
