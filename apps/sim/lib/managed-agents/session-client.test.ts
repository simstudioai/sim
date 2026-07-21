/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSessionCreatePayload, listSessionEvents } from '@/lib/managed-agents/session-client'

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

  it('includes memory instructions when provided', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      memoryInstructions: 'check before starting',
    })
    expect(payload.resources).toEqual([
      {
        type: 'memory_store',
        memory_store_id: 'memstore_01',
        access: 'read_write',
        instructions: 'check before starting',
      },
    ])
  })

  it('attaches file resources with an optional mount path', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      files: [{ fileId: 'file_1', mountPath: '/data/one' }, { fileId: 'file_2' }],
    })
    expect(payload.resources).toEqual([
      { type: 'file', file_id: 'file_1', mount_path: '/data/one' },
      { type: 'file', file_id: 'file_2' },
    ])
  })

  it('combines memory and file resources in order', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      files: [{ fileId: 'file_1' }],
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
      { type: 'file', file_id: 'file_1' },
    ])
  })

  it('omits `resources` when nothing is attached', () => {
    expect(buildSessionCreatePayload({ ...BASE }).resources).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, files: [] }).resources).toBeUndefined()
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

  it('keeps memory on resources and never folds it into metadata (cloud)', () => {
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

describe('buildSessionCreatePayload — self-hosted routing', () => {
  it('routes memory to metadata and never sends resources (self-hosted rejects resources)', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      environmentType: 'self_hosted',
      memoryStoreId: 'memstore_01',
      memoryAccess: 'read_only',
      sessionParameters: { SOURCE_TYPE: 'git' },
    })
    expect(payload.resources).toBeUndefined()
    expect(payload.metadata).toEqual({
      SOURCE_TYPE: 'git',
      memory_store_ids: 'memstore_01',
      memory_access: 'read_only',
    })
  })

  it('drops file attachments on self-hosted (not supported as resources)', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      environmentType: 'self_hosted',
      files: [{ fileId: 'file_1' }],
    })
    expect(payload.resources).toBeUndefined()
    expect(payload.metadata).toBeUndefined()
  })

  it('cloud (default) still attaches memory + files as resources', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      environmentType: 'cloud',
      memoryStoreId: 'memstore_01',
      files: [{ fileId: 'file_1' }],
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
      { type: 'file', file_id: 'file_1' },
    ])
    expect(payload.metadata).toBeUndefined()
  })
})

describe('listSessionEvents — ordering', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('orders events by processed_at ascending, with queued (null) events last', async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        data: [
          { id: 'c', type: 'agent.message', processed_at: '2026-01-01T00:00:03Z' },
          { id: 'a', type: 'agent.message', processed_at: '2026-01-01T00:00:01Z' },
          { id: 'queued', type: 'agent.message', processed_at: null },
          { id: 'b', type: 'agent.message', processed_at: '2026-01-01T00:00:02Z' },
        ],
        next_page: null,
      })
    ) as unknown as typeof fetch

    const events = await listSessionEvents({ apiKey: 'sk-ant-fake', sessionId: 'sess_1' })

    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c', 'queued'])
  })
})
