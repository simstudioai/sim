import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { uploadsMetadataMock } from '@sim/testing/mocks/uploads-metadata.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { accountStorageSweepOutboxHandlers } from '@/lib/users/storage-sweep'
import {
  ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT,
  ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT,
} from '@/lib/users/storage-sweep-events'

const sweep = accountStorageSweepOutboxHandlers[ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT]
const cleanup = accountStorageSweepOutboxHandlers[ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT]

let root: string

function outboxContext(overrides: Partial<OutboxEventContext> = {}): OutboxEventContext {
  return {
    eventId: 'event-1',
    eventType: ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(async () => {}),
    ...overrides,
  }
}

async function put(key: string, body = 'x'): Promise<void> {
  await mkdir(dirname(join(root, key)), { recursive: true })
  await writeFile(join(root, key), body)
}

async function exists(key: string): Promise<boolean> {
  try {
    await stat(join(root, key))
    return true
  } catch {
    return false
  }
}

const DOOMED_KEYS = [
  'workspace/ws1/a.txt',
  'workspace/ws1/nested/b.txt',
  'table-import/ws1/import-1/rows.csv',
  'execution/ws1/wf/ex/large-value-lv_1.json',
  'table-snapshots/ws1/table-1/v1-hash.csv',
  'copilot-doc-compiled/ws1/hash.pdf',
  'workspace-logos/ws1/logo.png',
]

const NEIGHBOR_KEYS = [
  'workspace/ws10/keep.txt',
  'workspace/ws1-archive/keep.txt',
  'execution/ws10/wf/ex/keep.json',
  'project/ws1/keep.txt',
  'kb/ws1/keep.txt',
]

describe('deleted workspace storage sweep', () => {
  beforeEach(async () => {
    resetDbChainMock()
    root = await mkdtemp(join(tmpdir(), 'sim-account-sweep-'))
    setUploadDirServer(root)
    for (const key of [...DOOMED_KEYS, ...NEIGHBOR_KEYS]) await put(key)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('deletes every family under the workspace prefix and nothing under a neighboring id', async () => {
    await expect(sweep({ version: 1, workspaceId: 'ws1' }, outboxContext())).resolves.toBe(
      undefined
    )

    for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(false)
    for (const key of NEIGHBOR_KEYS) expect(await exists(key)).toBe(true)
    expect(await exists('workspace/ws1')).toBe(false)
  })

  it('touches nothing while a workspace row with that id exists', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'ws1' }])

    await expect(sweep({ version: 1, workspaceId: 'ws1' }, outboxContext())).resolves.toBe(
      undefined
    )

    for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(true)
  })

  it('keeps an object a surviving row still references', async () => {
    queueTableRows(schemaMock.document, [{ key: 'workspace/ws1/a.txt' }])

    await sweep({ version: 1, workspaceId: 'ws1' }, outboxContext())

    expect(await exists('workspace/ws1/a.txt')).toBe(true)
    expect(await exists('workspace/ws1/nested/b.txt')).toBe(false)
  })

  it('walks past a full listing page within one run', async () => {
    const keys = Array.from({ length: 510 }, (_, index) => `workspace/ws1/bulk/${index}.bin`)
    for (const key of keys) await put(key)

    await expect(sweep({ version: 1, workspaceId: 'ws1' }, outboxContext())).resolves.toBe(
      undefined
    )

    for (const key of keys) expect(await exists(key)).toBe(false)
  })

  it('resumes from its checkpointed family', async () => {
    await sweep({ version: 1, workspaceId: 'ws1', family: 2 }, outboxContext())

    expect(await exists('workspace/ws1/a.txt')).toBe(true)
    expect(await exists('table-import/ws1/import-1/rows.csv')).toBe(true)
    expect(await exists('execution/ws1/wf/ex/large-value-lv_1.json')).toBe(false)
  })

  it.each([
    { version: 1, workspaceId: '' },
    { version: 1, workspaceId: '../ws1' },
    { version: 1, workspaceId: 'ws1/' },
    { version: 1, workspaceId: '*' },
    { workspaceId: 'ws1' },
  ])('rejects an unbounded or malformed payload %o', async (payload) => {
    await expect(sweep(payload, outboxContext())).rejects.toThrow()
    for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(true)
  })
})

describe('account storage object cleanup', () => {
  beforeEach(async () => {
    resetDbChainMock()
    root = await mkdtemp(join(tmpdir(), 'sim-account-objects-'))
    setUploadDirServer(root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const payload = (objects: { key: string; context: string }[]) => ({
    version: 1,
    userId: 'user-1',
    objects,
  })

  it('deletes unreferenced objects and keeps referenced ones', async () => {
    await put('copilot/abc/private.txt')
    await put('workspace/ws2/handed-off.txt')
    queueTableRows(schemaMock.workspaceFiles, [{ key: 'workspace/ws2/handed-off.txt' }])

    await cleanup(
      payload([
        { key: 'copilot/abc/private.txt', context: 'copilot' },
        { key: 'workspace/ws2/handed-off.txt', context: 'workspace' },
        { key: 'copilot/abc/already-gone.txt', context: 'copilot' },
      ]),
      outboxContext()
    )

    expect(await exists('copilot/abc/private.txt')).toBe(false)
    expect(await readFile(join(root, 'workspace/ws2/handed-off.txt'), 'utf8')).toBe('x')
  })

  it('touches nothing while the account exists', async () => {
    await put('copilot/abc/private.txt')
    queueTableRows(schemaMock.user, [{ id: 'user-1' }])

    await cleanup(
      payload([{ key: 'copilot/abc/private.txt', context: 'copilot' }]),
      outboxContext()
    )

    expect(await exists('copilot/abc/private.txt')).toBe(true)
  })

  it('fails so the outbox retries when a deletion fails, then completes', async () => {
    await mkdir(join(root, 'copilot/abc/blocked.txt/child'), { recursive: true })
    const objects = [{ key: 'copilot/abc/blocked.txt', context: 'copilot' }]

    await expect(cleanup(payload(objects), outboxContext())).rejects.toThrow()

    await rm(join(root, 'copilot/abc/blocked.txt'), { recursive: true })
    await put('copilot/abc/blocked.txt')
    await cleanup(payload(objects), outboxContext())
    expect(await exists('copilot/abc/blocked.txt')).toBe(false)
  })

  it.each([
    { key: 'project/p1/file.txt', context: 'workspace' },
    { key: 'assistant/org/user/file.png', context: 'mothership' },
    { key: '../outside.txt', context: 'workspace' },
    { key: 'workspace/ws2/file.txt', context: 'og-images' },
  ])('refuses a batch naming %o', async (object) => {
    await expect(cleanup(payload([object]), outboxContext())).rejects.toThrow(
      'Invalid account storage cleanup object'
    )
  })
})
