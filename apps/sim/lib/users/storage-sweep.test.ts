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
vi.mock('@/lib/uploads/core/prefix-sweep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads/core/prefix-sweep')>()
  return { ...actual, listStorageKeyPage: vi.fn(actual.listStorageKeyPage) }
})

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'
import { listStorageKeyPage } from '@/lib/uploads/core/prefix-sweep'
import { createStorageReferenceGuard } from '@/lib/users/storage-reference-guard'
import {
  accountStorageSweepOutboxHandlers,
  collectAccountStorageObjects,
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

/** A context whose deadline is near once it has listed `listings` storage pages. */
function deadlineAfter(listings: number, overrides: Partial<OutboxEventContext> = {}) {
  const context = outboxContext(overrides)
  const listed = vi.mocked(listStorageKeyPage).mock.calls.length
  Object.defineProperty(context, 'deadlineAt', {
    get: () =>
      vi.mocked(listStorageKeyPage).mock.calls.length - listed >= listings
        ? 1
        : Number.POSITIVE_INFINITY,
  })
  return context
}

/** Re-runs the sweep the way the outbox does, merging each checkpoint into the next payload. */
async function sweepUntilSettled(payload: Record<string, unknown>, listingsPerRun: number) {
  let current = payload
  const outcomes: Awaited<ReturnType<typeof sweep>>[] = []
  for (let run = 0; run < 12; run++) {
    const outcome = await sweep(
      current,
      deadlineAfter(listingsPerRun, {
        checkpointPayload: vi.fn(async (patch: Record<string, unknown>) => {
          current = { ...current, ...patch }
        }),
      })
    )
    outcomes.push(outcome)
    if (outcome === undefined) break
  }
  return outcomes
}

async function put(key: string, body = 'x'): Promise<void> {
  await mkdir(dirname(join(root, key)), { recursive: true })
  await writeFile(join(root, key), body)
}

/** Writes `count` objects a surviving document names, answering `lookups` reference checks. */
async function putKept(count: number, lookups = 1): Promise<string[]> {
  const width = String(count - 1).length
  const keys = Array.from(
    { length: count },
    (_, index) => `workspace/wsdoomed1/a-kept/${String(index).padStart(width, '0')}.bin`
  )
  for (const key of keys) await put(key)
  for (let lookup = 0; lookup < lookups; lookup++)
    queueTableRows(
      schemaMock.document,
      keys.map((key) => ({ key }))
    )
  return keys
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
  'workspace/wsdoomed1/a.txt',
  'workspace/wsdoomed1/nested/b.txt',
  'table-import/wsdoomed1/import-1/rows.csv',
  'execution/wsdoomed1/wf/ex/large-value-lv_1.json',
  'table-snapshots/wsdoomed1/table-1/v1-hash.csv',
  'copilot-doc-compiled/wsdoomed1/hash.pdf',
  'workspace-logos/wsdoomed1/logo.png',
  'knowledge-import/wsdoomed1/import-1/bundle.simkb.zip',
]

const NEIGHBOR_KEYS = [
  'workspace/wsdoomed10/keep.txt',
  'workspace/wsdoomed1-archive/keep.txt',
  'execution/wsdoomed10/wf/ex/keep.json',
  'project/wsdoomed1/keep.txt',
  'kb/wsdoomed1/keep.txt',
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
    await expect(sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())).resolves.toBe(
      undefined
    )

    for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(false)
    for (const key of NEIGHBOR_KEYS) expect(await exists(key)).toBe(true)
    expect(await exists('workspace/wsdoomed1')).toBe(false)
  })

  it('touches nothing while a workspace row with that id exists', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'wsdoomed1' }])

    await expect(sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())).resolves.toBe(
      undefined
    )

    for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(true)
  })

  it('keeps an object a surviving row still references', async () => {
    queueTableRows(schemaMock.document, [{ key: 'workspace/wsdoomed1/a.txt' }])

    await sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())

    expect(await exists('workspace/wsdoomed1/a.txt')).toBe(true)
    expect(await exists('workspace/wsdoomed1/nested/b.txt')).toBe(false)
  })

  it('stops deleting once the workspace reappears mid-sweep', async () => {
    const keys = Array.from({ length: 510 }, (_, index) => `workspace/wsdoomed1/bulk/${index}.bin`)
    for (const key of keys) await put(key)
    queueTableRows(schemaMock.workspace, [])
    queueTableRows(schemaMock.workspace, [])
    queueTableRows(schemaMock.workspace, [{ id: 'wsdoomed1' }])

    await expect(sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())).resolves.toBe(
      undefined
    )

    const remaining = await Promise.all(keys.map(exists))
    expect(remaining.filter(Boolean).length).toBeGreaterThan(0)
    expect(await exists('workspace-logos/wsdoomed1/logo.png')).toBe(true)
  })

  it('keeps a public object a URL written mid-sweep names', async () => {
    const logos = Array.from(
      { length: 510 },
      (_, index) => `workspace-logos/wsdoomed1/l/${String(index).padStart(3, '0')}.png`
    )
    for (const key of logos) await put(key)
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [
      { id: 'user-9', value: '/api/files/serve/workspace-logos%2Fwsdoomed1%2Fl%2F505.png' },
    ])

    await sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())

    expect(await exists('workspace-logos/wsdoomed1/l/505.png')).toBe(true)
    expect(await exists('workspace-logos/wsdoomed1/l/504.png')).toBe(false)
  })

  it('walks past a full listing page within one run', async () => {
    const keys = Array.from({ length: 510 }, (_, index) => `workspace/wsdoomed1/bulk/${index}.bin`)
    for (const key of keys) await put(key)

    await expect(sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())).resolves.toBe(
      undefined
    )

    for (const key of keys) expect(await exists(key)).toBe(false)
  })

  it('resumes from its checkpointed family', async () => {
    await sweep({ version: 1, workspaceId: 'wsdoomed1', family: 2 }, outboxContext())

    expect(await exists('workspace/wsdoomed1/a.txt')).toBe(true)
    expect(await exists('table-import/wsdoomed1/import-1/rows.csv')).toBe(true)
    expect(await exists('execution/wsdoomed1/wf/ex/large-value-lv_1.json')).toBe(false)
  })

  it.each([
    {
      name: 'an organization whitelabel logo serve URL',
      table: 'organization',
      row: {
        logo: null,
        whitelabel: {
          logoUrl: 'https://sim.test/api/files/serve/s3/workspace-logos%2Fwsdoomed1%2Flogo.png',
        },
        metadata: null,
      },
    },
    {
      name: 'a custom block icon stored as a direct bucket URL',
      table: 'customBlock',
      row: { value: 'https://bucket.s3.amazonaws.com/workspace-logos/wsdoomed1/logo.png' },
    },
    {
      name: 'a deployed chat avatar',
      table: 'chat',
      row: {
        value: { imageUrl: '/api/files/serve/workspace-logos/wsdoomed1/logo.png?context=chat' },
      },
    },
    {
      name: 'another account image',
      table: 'user',
      row: { value: '/api/files/serve/workspace-logos/wsdoomed1/logo.png' },
    },
  ] as const)('keeps an object named by $name', async ({ table, row }) => {
    queueTableRows(schemaMock[table], [row])

    await sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())

    expect(await exists('workspace-logos/wsdoomed1/logo.png')).toBe(true)
    expect(await exists('workspace/wsdoomed1/a.txt')).toBe(false)
  })

  it('keeps the local metadata sidecar of a kept object', async () => {
    await put('workspace/wsdoomed1/a.txt.upload-metadata.json', '{}')
    await put('workspace/wsdoomed1/nested/b.txt.upload-metadata.json', '{}')
    queueTableRows(schemaMock.document, [{ key: 'workspace/wsdoomed1/a.txt' }])

    await sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())

    expect(await exists('workspace/wsdoomed1/a.txt')).toBe(true)
    expect(await exists('workspace/wsdoomed1/a.txt.upload-metadata.json')).toBe(true)
    expect(await exists('workspace/wsdoomed1/nested/b.txt.upload-metadata.json')).toBe(false)
  })

  it('pages past a full page of kept objects to the ones behind it', async () => {
    const keptKeys = Array.from(
      { length: 520 },
      (_, index) => `workspace/wsdoomed1/a-kept/${String(index).padStart(3, '0')}.bin`
    )
    const unkeptKeys = Array.from(
      { length: 10 },
      (_, index) => `workspace/wsdoomed1/z-unkept/${index}.bin`
    )
    for (const key of [...keptKeys, ...unkeptKeys]) await put(key)
    queueTableRows(
      schemaMock.document,
      keptKeys.map((key) => ({ key }))
    )
    queueTableRows(
      schemaMock.document,
      keptKeys.map((key) => ({ key }))
    )

    await expect(sweep({ version: 1, workspaceId: 'wsdoomed1' }, outboxContext())).resolves.toBe(
      undefined
    )

    for (const key of unkeptKeys) expect(await exists(key)).toBe(false)
    for (const key of keptKeys) expect(await exists(key)).toBe(true)
  })

  it('reaches objects behind more kept pages than one run can walk, spending no attempt', async () => {
    const keptKeys = await putKept(1000, 30)
    await put('workspace/wsdoomed1/z-unkept/0.bin')

    const outcomes = await sweepUntilSettled({ version: 1, workspaceId: 'wsdoomed1' }, 2)

    expect(outcomes.at(-1)).toBeUndefined()
    for (const outcome of outcomes.slice(0, -1))
      expect(outcome).toMatchObject({ consumeAttempt: false })
    expect(await exists('workspace/wsdoomed1/z-unkept/0.bin')).toBe(false)
    for (const key of keptKeys) expect(await exists(key)).toBe(true)
  })

  it('resumes a family from its saved listing position', async () => {
    const checkpointPayload = vi.fn(async () => {})

    await expect(
      sweep(
        { version: 1, workspaceId: 'wsdoomed1', family: 0, pageToken: 'workspace/wsdoomed1/a.txt' },
        outboxContext({ checkpointPayload })
      )
    ).resolves.toBe(undefined)

    expect(await exists('workspace/wsdoomed1/a.txt')).toBe(true)
    expect(await exists('workspace/wsdoomed1/nested/b.txt')).toBe(false)
    expect(await exists('table-import/wsdoomed1/import-1/rows.csv')).toBe(false)
    expect(checkpointPayload).toHaveBeenCalledWith({ family: 1, pageToken: null })
  })

  it('retries a saved position that failed to list once instead of walking from the start', async () => {
    let payload: Record<string, unknown> = {
      version: 1,
      workspaceId: 'wsdoomed1',
      pageToken: 'workspace/wsdoomed1/a.txt',
    }
    const checkpointPayload = vi.fn(async (patch: Record<string, unknown>) => {
      payload = { ...payload, ...patch }
    })
    vi.mocked(listStorageKeyPage).mockRejectedValueOnce(new Error('Service unavailable'))

    await expect(sweep(payload, outboxContext({ checkpointPayload }))).rejects.toThrow(
      'Service unavailable'
    )
    for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(true)
    expect(payload).toMatchObject({ pageToken: 'workspace/wsdoomed1/a.txt', tokenFailures: 1 })

    await expect(sweep(payload, outboxContext({ checkpointPayload }))).resolves.toBe(undefined)
    expect(await exists('workspace/wsdoomed1/a.txt')).toBe(true)
    expect(await exists('workspace/wsdoomed1/nested/b.txt')).toBe(false)
    expect(payload).toMatchObject({ tokenFailures: 0 })
  })

  it.each([
    { name: 'no longer lists', pageToken: 'expired-token', rejects: true },
    { name: 'is not a key under the prefix', pageToken: 'zz-other-provider', rejects: false },
  ])(
    'walks the family from the start once its saved position $name on a second attempt',
    async ({ pageToken, rejects }) => {
      let payload: Record<string, unknown> = { version: 1, workspaceId: 'wsdoomed1', pageToken }
      const checkpointPayload = vi.fn(async (patch: Record<string, unknown>) => {
        payload = { ...payload, ...patch }
      })
      const invalid = new Error('The continuation token is invalid')
      if (rejects)
        vi.mocked(listStorageKeyPage).mockRejectedValueOnce(invalid).mockRejectedValueOnce(invalid)

      await expect(sweep(payload, outboxContext({ checkpointPayload }))).rejects.toThrow()
      for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(true)

      await expect(sweep(payload, outboxContext({ checkpointPayload }))).resolves.toBe(undefined)
      for (const key of DOOMED_KEYS) expect(await exists(key)).toBe(false)
    }
  )

  it('spends an attempt when a restart from a rejected position only walks kept objects', async () => {
    const keptKeys = await putKept(500)
    vi.mocked(listStorageKeyPage).mockRejectedValueOnce(
      new Error('The continuation token is invalid')
    )
    const checkpointPayload = vi.fn(async () => {})

    const outcome = await sweep(
      { version: 1, workspaceId: 'wsdoomed1', pageToken: 'expired-token', tokenFailures: 1 },
      deadlineAfter(2, { checkpointPayload })
    )

    expect(outcome).toMatchObject({ outcome: 'deferred' })
    expect(outcome).not.toHaveProperty('consumeAttempt')
    expect(checkpointPayload).toHaveBeenCalledWith({
      family: 0,
      pageToken: keptKeys.at(-1),
      resumes: 0,
    })
  })

  it('spends an attempt on a moved position once its resume budget is gone', async () => {
    const keptKeys = await putKept(1000)
    const checkpointPayload = vi.fn(async () => {})

    const outcome = await sweep(
      { version: 1, workspaceId: 'wsdoomed1', resumes: 1000 },
      deadlineAfter(1, { checkpointPayload })
    )

    expect(outcome).toMatchObject({ outcome: 'deferred' })
    expect(outcome).not.toHaveProperty('consumeAttempt')
    expect(checkpointPayload).toHaveBeenCalledWith({
      family: 0,
      pageToken: keptKeys[499],
      resumes: 1001,
    })
  })

  it.each([
    { version: 1, workspaceId: '' },
    { version: 1, workspaceId: '../wsdoomed1' },
    { version: 1, workspaceId: 'wsdoomed1/' },
    { version: 1, workspaceId: '*' },
    { workspaceId: 'wsdoomed1' },
    { version: 1, workspaceId: 'wsdoomed1', pageToken: 42 },
    { version: 1, workspaceId: 'wsdoomed1', pageToken: '' },
    { version: 1, workspaceId: 'wsdoomed1', pageToken: 'x'.repeat(4097) },
    { version: 1, workspaceId: 'wsdoomed1', resumes: -1 },
    { version: 1, workspaceId: 'wsdoomed1', resumes: '1' },
    { version: 1, workspaceId: 'wsdoomed1', tokenFailures: 2 },
    { version: 1, workspaceId: 'wsdoomed1', tokenFailures: '1' },
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
    await put('workspace/wsliving2/handed-off.txt')
    queueTableRows(schemaMock.workspaceFiles, [{ key: 'workspace/wsliving2/handed-off.txt' }])

    await cleanup(
      payload([
        { key: 'copilot/abc/private.txt', context: 'copilot' },
        { key: 'workspace/wsliving2/handed-off.txt', context: 'workspace' },
        { key: 'copilot/abc/already-gone.txt', context: 'copilot' },
      ]),
      outboxContext()
    )

    expect(await exists('copilot/abc/private.txt')).toBe(false)
    expect(await readFile(join(root, 'workspace/wsliving2/handed-off.txt'), 'utf8')).toBe('x')
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
    await put('workspace/wsliving2/private.txt')
    await put('copilot/abc/private.txt')
    queueTableRows(schemaMock.workspace, [{ id: 'wsliving2' }])

    await cleanup(
      payload([
        { key: 'workspace/wsliving2/private.txt', context: 'mothership' },
        { key: 'copilot/abc/private.txt', context: 'copilot' },
      ]),
      outboxContext()
    )

    expect(await exists('workspace/wsliving2/private.txt')).toBe(true)
    expect(await exists('copilot/abc/private.txt')).toBe(false)
  })

  it('keeps a publicly served key a stored asset URL names', async () => {
    await put('workspace-logos/wsforeign9/icon.png')
    queueTableRows(schemaMock.oauthClient, [
      { value: '/api/files/serve/workspace-logos%2Fwsforeign9%2Ficon.png' },
    ])

    await cleanup(
      payload([{ key: 'workspace-logos/wsforeign9/icon.png', context: 'workspace-logos' }]),
      outboxContext()
    )

    expect(await exists('workspace-logos/wsforeign9/icon.png')).toBe(true)
  })

  it.each([
    {
      key: 'workspace-logos/wsforeign9/icon.png',
      url: '/api/files/serve/workspace-logos%2Fwsforeign9%2Ficon.png#v2',
    },
    {
      key: 'workspace-logos/wsforeign9/brand logo%.png',
      url: '/api/files/serve/workspace-logos/wsforeign9/brand%20logo%.png#v2',
    },
  ])('keeps a public key a relative URL with a fragment names: $url', async ({ key, url }) => {
    const storedAs = key.replace(/[ %]/g, '_')
    await put(storedAs)
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [{ value: url }])

    await cleanup(payload([{ key, context: 'workspace-logos' }]), outboxContext())

    expect(await exists(storedAs)).toBe(true)
  })

  it('keeps a public key without an owner id to narrow on, reading no URL column', async () => {
    await put('og-images/logo.png')

    await cleanup(payload([{ key: 'og-images/logo.png', context: 'workspace' }]), outboxContext())

    expect(await exists('og-images/logo.png')).toBe(true)
    for (const table of ['organization', 'customBlock', 'chat', 'oauthClient'] as const)
      expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock[table])
  })

  it("keeps an avatar another account's image still names", async () => {
    const key = 'profile-pictures/upload-0002-owner-avatar.png'
    await put(key)
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [
      { id: 'owner-1', value: `/api/files/serve/s3/${encodeURIComponent(key)}` },
    ])

    await cleanup(payload([{ key, context: 'profile-pictures' }]), outboxContext())

    expect(await exists(key)).toBe(true)
  })

  it("deletes the account's own uploaded avatar", async () => {
    await put('profile-pictures/upload-0001-avatar.png')

    await cleanup(
      payload([{ key: 'profile-pictures/upload-0001-avatar.png', context: 'profile-pictures' }]),
      outboxContext()
    )

    expect(await exists('profile-pictures/upload-0001-avatar.png')).toBe(false)
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
    await put('workspace-logos/wsforeign9/old.png')
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [{ value: '/api/files/serve/%E0%A4%A' }])

    await cleanup(
      payload([{ key: 'workspace-logos/wsforeign9/old.png', context: 'workspace-logos' }]),
      outboxContext()
    )

    expect(await exists('workspace-logos/wsforeign9/old.png')).toBe(false)
  })

  it('keeps a legacy key holding a literal percent sign that a malformed URL names', async () => {
    const key = 'workspace-logos/wsforeign9/brand logo%.png'
    const storedAs = 'workspace-logos/wsforeign9/brand_logo_.png'
    await put(storedAs)
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [
      { value: '/api/files/serve/workspace-logos/wsforeign9/brand%20logo%.png' },
    ])

    await cleanup(payload([{ key, context: 'workspace-logos' }]), outboxContext())

    expect(await exists(storedAs)).toBe(true)
  })

  it.each([
    { key: 'project/p1/file.txt', context: 'workspace' },
    { key: 'assistant/org/user/file.png', context: 'mothership' },
    { key: '../outside.txt', context: 'workspace' },
    { key: 'workspace/wsliving2/file.txt', context: 'og-images' },
    { key: 'profile-pictures/user-9/logo.png', context: 'workspace' },
    { key: 'organization-logos/org-1/logo.png', context: 'workspace' },
  ])('refuses a batch naming %o', async (object) => {
    await expect(cleanup(payload([object]), outboxContext())).rejects.toThrow(
      'Invalid account storage cleanup object'
    )
  })
})

describe('storage reference guard', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('keeps a key under a workspace that still exists for every caller', async () => {
    queueTableRows(schemaMock.workspace, [{ id: 'wsliving2' }])

    const kept = await createStorageReferenceGuard()([
      'execution/wsliving2/wf/ex/file.json',
      'execution/wsdoomed1/wf/ex/file.json',
    ])

    expect([...kept]).toEqual(['execution/wsliving2/wf/ex/file.json'])
  })
})

describe('queueing account storage cleanup', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  async function queueCleanup(): Promise<void> {
    const objects = await collectAccountStorageObjects({ userId: 'user-1', workspaceIds: [] })
    await enqueueAccountStorageCleanupInTx(dbChainMock.db as unknown as DbTransaction, {
      userId: 'user-1',
      workspaceIds: [],
      objects,
    })
  }

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

    await queueCleanup()

    const keys = queuedObjectKeys()
    expect(keys).toHaveLength(1006)
    expect(keys).toContain('copilot/abc/v1004.txt')
  })

  it('queues a file committed between the early read and the deletion locks, once', async () => {
    const early = { id: 'file-1', key: 'copilot/abc/early.txt', context: 'copilot' }
    queueTableRows(schemaMock.workspaceFiles, [early])
    const objects = await collectAccountStorageObjects({ userId: 'user-1', workspaceIds: [] })
    queueTableRows(schemaMock.workspaceFiles, [
      early,
      { id: 'file-2', key: 'copilot/abc/late.txt', context: 'copilot' },
    ])

    await enqueueAccountStorageCleanupInTx(dbChainMock.db as unknown as DbTransaction, {
      userId: 'user-1',
      workspaceIds: [],
      objects,
    })

    expect(queuedObjectKeys()).toEqual(['copilot/abc/early.txt', 'copilot/abc/late.txt'])
  })

  it("queues the account's own uploaded avatar", async () => {
    queueTableRows(schemaMock.user, [
      { image: '/api/files/serve/s3/profile-pictures%2Fupload-0001-avatar.png' },
    ])

    await queueCleanup()

    expect(queuedObjectKeys()).toEqual(['profile-pictures/upload-0001-avatar.png'])
  })

  it('never queues an avatar key that could escape its root', async () => {
    queueTableRows(schemaMock.user, [
      { image: '/api/files/serve/profile-pictures%2Fx%2F..%2F..%2Fworkspace%2Fother.png' },
    ])

    await queueCleanup()

    expect(queuedObjectKeys()).toEqual([])
  })

  it('never queues a profile picture row', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      { id: 'file-1', key: 'profile-pictures/org-logo.png', context: 'profile-pictures' },
      { id: 'file-2', key: 'copilot/abc/file.txt', context: 'copilot' },
    ])

    await queueCleanup()

    expect(queuedObjectKeys()).toEqual(['copilot/abc/file.txt'])
  })
})
