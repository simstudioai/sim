import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { uploadsMetadataMock } from '@sim/testing/mocks/uploads-metadata.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'
import {
  accountStorageSweepOutboxHandlers,
  enqueueAccountStorageCleanupInTx,
} from '@/lib/users/storage-sweep'
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
    {
      name: 'an organization whitelabel logo serve URL',
      table: 'organization',
      row: {
        logo: null,
        whitelabel: {
          logoUrl: 'https://sim.test/api/files/serve/s3/workspace-logos%2Fws1%2Flogo.png',
        },
        metadata: null,
      },
    },
    {
      name: 'a custom block icon stored as a direct bucket URL',
      table: 'customBlock',
      row: { value: 'https://bucket.s3.amazonaws.com/workspace-logos/ws1/logo.png' },
    },
    {
      name: 'a deployed chat avatar',
      table: 'chat',
      row: { value: { imageUrl: '/api/files/serve/workspace-logos/ws1/logo.png?context=chat' } },
    },
    {
      name: 'another account image',
      table: 'user',
      row: { value: '/api/files/serve/workspace-logos/ws1/logo.png' },
    },
  ] as const)('keeps an object named by $name', async ({ table, row }) => {
    queueTableRows(schemaMock[table], [row])

    await sweep({ version: 1, workspaceId: 'ws1' }, outboxContext())

    expect(await exists('workspace-logos/ws1/logo.png')).toBe(true)
    expect(await exists('workspace/ws1/a.txt')).toBe(false)
  })

  it('keeps the local metadata sidecar of a kept object', async () => {
    await put('workspace/ws1/a.txt.upload-metadata.json', '{}')
    await put('workspace/ws1/nested/b.txt.upload-metadata.json', '{}')
    queueTableRows(schemaMock.document, [{ key: 'workspace/ws1/a.txt' }])

    await sweep({ version: 1, workspaceId: 'ws1' }, outboxContext())

    expect(await exists('workspace/ws1/a.txt')).toBe(true)
    expect(await exists('workspace/ws1/a.txt.upload-metadata.json')).toBe(true)
    expect(await exists('workspace/ws1/nested/b.txt.upload-metadata.json')).toBe(false)
  })

  it('spends an attempt instead of continuing when a full local page removes nothing', async () => {
    for (let index = 0; index < 520; index++)
      await put(`workspace/ws1/legacy/legacy file ${index}.txt`)

    const result = await sweep(
      { version: 1, workspaceId: 'ws1' },
      outboxContext({ deadlineAt: Date.now() + 120_000 })
    )

    expect(result).toEqual({
      outcome: 'deferred',
      reason: 'Workspace storage sweep removed nothing from a full listing page',
    })
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

  it('keeps a key under a workspace that still exists', async () => {
    await put('workspace/ws2/private.txt')
    await put('copilot/abc/private.txt')
    queueTableRows(schemaMock.workspace, [{ id: 'ws2' }])

    await cleanup(
      payload([
        { key: 'workspace/ws2/private.txt', context: 'mothership' },
        { key: 'copilot/abc/private.txt', context: 'copilot' },
      ]),
      outboxContext()
    )

    expect(await exists('workspace/ws2/private.txt')).toBe(true)
    expect(await exists('copilot/abc/private.txt')).toBe(false)
  })

  it('keeps a publicly served key a stored asset URL names', async () => {
    await put('workspace-logos/ws9/icon.png')
    queueTableRows(schemaMock.oauthClient, [
      { value: '/api/files/serve/workspace-logos%2Fws9%2Ficon.png' },
    ])

    await cleanup(
      payload([{ key: 'workspace-logos/ws9/icon.png', context: 'workspace-logos' }]),
      outboxContext()
    )

    expect(await exists('workspace-logos/ws9/icon.png')).toBe(true)
  })

  it('reads no URL column for keys that are never served without a row', async () => {
    await put('copilot/abc/icon.png')
    queueTableRows(schemaMock.oauthClient, [{ value: '/api/files/serve/copilot%2Fabc%2Ficon.png' }])

    await cleanup(payload([{ key: 'copilot/abc/icon.png', context: 'copilot' }]), outboxContext())

    expect(await exists('copilot/abc/icon.png')).toBe(false)
    for (const table of ['organization', 'customBlock', 'chat', 'oauthClient'] as const)
      expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock[table])
  })

  it('still purges when a stored URL has malformed percent-encoding', async () => {
    await put('workspace-logos/ws9/old.png')
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [{ value: '/api/files/serve/%E0%A4%A' }])

    await cleanup(
      payload([{ key: 'workspace-logos/ws9/old.png', context: 'workspace-logos' }]),
      outboxContext()
    )

    expect(await exists('workspace-logos/ws9/old.png')).toBe(false)
  })

  it('keeps a legacy key holding a literal percent sign that a malformed URL names', async () => {
    const key = 'workspace-logos/ws9/brand logo%.png'
    const storedAs = 'workspace-logos/ws9/brand_logo_.png'
    await put(storedAs)
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [
      { value: '/api/files/serve/workspace-logos/ws9/brand%20logo%.png' },
    ])

    await cleanup(payload([{ key, context: 'workspace-logos' }]), outboxContext())

    expect(await exists(storedAs)).toBe(true)
  })

  it.each([
    { key: 'project/p1/file.txt', context: 'workspace' },
    { key: 'assistant/org/user/file.png', context: 'mothership' },
    { key: '../outside.txt', context: 'workspace' },
    { key: 'workspace/ws2/file.txt', context: 'og-images' },
    { key: 'profile-pictures/user-9/logo.png', context: 'profile-pictures' },
    { key: 'profile-pictures/user-9/logo.png', context: 'workspace' },
    { key: 'organization-logos/org-1/logo.png', context: 'workspace' },
  ])('refuses a batch naming %o', async (object) => {
    await expect(cleanup(payload([object]), outboxContext())).rejects.toThrow(
      'Invalid account storage cleanup object'
    )
  })
})

describe('queueing account storage cleanup', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  function queuedObjectKeys(): string[] {
    return dbChainMockFns.values.mock.calls.flatMap(([rows]) =>
      (rows as { payload: { objects?: { key: string }[] } }[]).flatMap(
        (row) => row.payload.objects?.map((object) => object.key) ?? []
      )
    )
  }

  it('queues every version of a private file across version pages', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      { id: 'file-1', key: 'copilot/abc/file.txt', context: 'copilot' },
    ])
    const versionPage = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `v-${String(start + index).padStart(5, '0')}`,
        key: `copilot/abc/v${start + index}.txt`,
        fileId: 'file-1',
      }))
    queueTableRows(schemaMock.workspaceFileVersion, versionPage(0, 1000))
    queueTableRows(schemaMock.workspaceFileVersion, versionPage(1000, 5))

    await enqueueAccountStorageCleanupInTx(dbChainMock.db as unknown as DbTransaction, {
      userId: 'user-1',
      workspaceIds: [],
    })

    const keys = queuedObjectKeys()
    expect(keys).toHaveLength(1006)
    expect(keys).toContain('copilot/abc/v1004.txt')
  })

  it('never queues a profile picture row', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      { id: 'file-1', key: 'profile-pictures/org-logo.png', context: 'profile-pictures' },
      { id: 'file-2', key: 'copilot/abc/file.txt', context: 'copilot' },
    ])

    await enqueueAccountStorageCleanupInTx(dbChainMock.db as unknown as DbTransaction, {
      userId: 'user-1',
      workspaceIds: [],
    })

    expect(queuedObjectKeys()).toEqual(['copilot/abc/file.txt'])
  })
})
