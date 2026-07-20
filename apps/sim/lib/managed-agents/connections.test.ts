/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbState, mockEncryptSecret, mockDecryptSecret, mockGenerateShortId } = vi.hoisted(
  () => ({
    dbState: {
      selectResults: [] as any[][],
      insertRows: [] as any[],
      updateArgs: [] as any[],
      deleteArgs: [] as any[],
      whereCalls: [] as any[],
    },
    // Opaque encryption mock: the ciphertext never contains the plaintext,
    // so tests can assert that the raw key does not leak into the row.
    mockEncryptSecret: vi.fn(async (value: string) => ({
      encrypted: Buffer.from(value).toString('base64'),
      iv: 'iv',
    })),
    mockDecryptSecret: vi.fn(async (value: string) => ({
      decrypted: Buffer.from(value, 'base64').toString('utf8'),
    })),
    mockGenerateShortId: vi.fn(() => 'gen-id-123'),
  })
)

function makeSelectChain() {
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn((...args: any[]) => {
    dbState.whereCalls.push(args)
    return chain
  })
  chain.orderBy = vi.fn(() => Promise.resolve(dbState.selectResults.shift() ?? []))
  chain.limit = vi.fn(() => Promise.resolve(dbState.selectResults.shift() ?? []))
  return chain
}

function makeInsertChain() {
  const chain: any = {}
  chain.values = vi.fn((row: any) => {
    dbState.insertRows.push(row)
    return Promise.resolve(undefined)
  })
  return chain
}

function makeUpdateChain() {
  const chain: any = {}
  const capture: any = {}
  chain.set = vi.fn((row: any) => {
    capture.set = row
    return chain
  })
  chain.where = vi.fn((...args: any[]) => {
    capture.where = args
    dbState.updateArgs.push(capture)
    return Promise.resolve(undefined)
  })
  return chain
}

function makeDeleteChain() {
  const chain: any = {}
  const capture: any = {}
  chain.where = vi.fn((...args: any[]) => {
    capture.where = args
    dbState.deleteArgs.push(capture)
    return Promise.resolve(undefined)
  })
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(() => makeInsertChain()),
    update: vi.fn(() => makeUpdateChain()),
    delete: vi.fn(() => makeDeleteChain()),
  },
}))

vi.mock('@sim/db/schema', () => ({
  managedAgentConnection: {
    id: 'managed_agent_connection.id',
    workspaceId: 'managed_agent_connection.workspaceId',
    createdAt: 'managed_agent_connection.createdAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@sim/utils/id', () => ({
  generateShortId: mockGenerateShortId,
}))

import {
  createConnection,
  deleteConnection,
  getDecryptedApiKey,
  listConnections,
  markVerificationResult,
  rotateConnectionKey,
} from '@/lib/managed-agents/connections'

const now = new Date('2026-07-19T00:00:00.000Z')
const PLAINTEXT_KEY = 'sk-ant-secret-key-1234567890abcdef'
const CIPHERTEXT_KEY = Buffer.from(PLAINTEXT_KEY).toString('base64')
const baseRow = {
  id: 'conn_1',
  workspaceId: 'ws_A',
  userId: 'user_1',
  name: 'prod',
  encryptedApiKey: CIPHERTEXT_KEY,
  lastVerifiedAt: now,
  lastVerificationError: null,
  createdAt: now,
  updatedAt: now,
}

describe('listConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.selectResults = []
    dbState.insertRows = []
    dbState.updateArgs = []
    dbState.deleteArgs = []
    dbState.whereCalls = []
  })

  it('returns a masked preview of each connection and never exposes the plaintext', async () => {
    dbState.selectResults = [[baseRow]]
    const results = await listConnections({ workspaceId: 'ws_A' })
    expect(results).toHaveLength(1)
    expect(results[0]).not.toHaveProperty('encryptedApiKey')
    // 8-char prefix + `…` + 4-char suffix.
    expect(results[0].maskedApiKey).toBe('sk-ant-s…cdef')
  })

  it('falls back to a solid bullet mask when a row cannot be decrypted', async () => {
    dbState.selectResults = [[baseRow]]
    mockDecryptSecret.mockRejectedValueOnce(new Error('bad tag'))
    const results = await listConnections({ workspaceId: 'ws_A' })
    expect(results[0].maskedApiKey).toBe('••••••••')
  })

  it('scopes the query to the requested workspaceId', async () => {
    dbState.selectResults = [[]]
    await listConnections({ workspaceId: 'ws_A' })
    expect(dbState.whereCalls).toHaveLength(1)
    // The where argument must reference the workspaceId column and value.
    expect(JSON.stringify(dbState.whereCalls[0])).toContain('ws_A')
  })
})

describe('getDecryptedApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.selectResults = []
    dbState.whereCalls = []
  })

  it('returns the decrypted plaintext when the connection exists', async () => {
    dbState.selectResults = [[baseRow]]
    const key = await getDecryptedApiKey({ id: 'conn_1', workspaceId: 'ws_A' })
    expect(key).toBe(PLAINTEXT_KEY)
    // The DB lookup must include BOTH id and workspaceId (no cross-workspace read).
    expect(JSON.stringify(dbState.whereCalls[0])).toContain('conn_1')
    expect(JSON.stringify(dbState.whereCalls[0])).toContain('ws_A')
  })

  it('returns null when the connection does not exist for that workspace', async () => {
    dbState.selectResults = [[]]
    const key = await getDecryptedApiKey({ id: 'conn_1', workspaceId: 'ws_A' })
    expect(key).toBeNull()
  })
})

describe('createConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.selectResults = []
    dbState.insertRows = []
    dbState.whereCalls = []
    mockGenerateShortId.mockReturnValue('gen-id-123')
  })

  it('encrypts the api key before persisting and never writes plaintext', async () => {
    const plaintext = 'sk-ant-plaintext-secret-9999'
    const expectedCiphertext = Buffer.from(plaintext).toString('base64')
    dbState.selectResults = [[{ ...baseRow, id: 'gen-id-123' }]] // getConnection after insert
    await createConnection({
      workspaceId: 'ws_A',
      userId: 'user_1',
      name: 'prod',
      apiKey: plaintext,
    })
    expect(mockEncryptSecret).toHaveBeenCalledWith(plaintext)
    const inserted = dbState.insertRows[0]
    expect(inserted.encryptedApiKey).toBe(expectedCiphertext)
    // The raw key MUST NOT appear anywhere in the persisted row.
    expect(JSON.stringify(inserted)).not.toContain(plaintext)
  })

  it('persists the connection under the provided workspaceId', async () => {
    dbState.selectResults = [[{ ...baseRow, id: 'gen-id-123', workspaceId: 'ws_A' }]]
    await createConnection({
      workspaceId: 'ws_A',
      userId: 'user_1',
      name: 'prod',
      apiKey: 'sk-ant-plaintext',
    })
    expect(dbState.insertRows[0].workspaceId).toBe('ws_A')
  })

  it('runs `verify` before writing and aborts on failure', async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'Anthropic rejected the key' })
    await expect(
      createConnection({
        workspaceId: 'ws_A',
        userId: 'user_1',
        name: 'prod',
        apiKey: 'sk-ant-bad',
        verify,
      })
    ).rejects.toThrow('Anthropic rejected the key')
    expect(dbState.insertRows).toHaveLength(0)
    expect(mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('sets lastVerifiedAt when verify passes, null otherwise', async () => {
    dbState.selectResults = [[{ ...baseRow, id: 'gen-id-123' }]]
    await createConnection({
      workspaceId: 'ws_A',
      userId: 'user_1',
      name: 'prod',
      apiKey: 'sk-ant-plaintext',
      verify: async () => ({ ok: true }),
    })
    expect(dbState.insertRows[0].lastVerifiedAt).toBeInstanceOf(Date)

    dbState.selectResults = [[{ ...baseRow, id: 'gen-id-123' }]]
    dbState.insertRows.length = 0
    await createConnection({
      workspaceId: 'ws_A',
      userId: 'user_1',
      name: 'prod',
      apiKey: 'sk-ant-plaintext',
    })
    expect(dbState.insertRows[0].lastVerifiedAt).toBeNull()
  })
})

describe('deleteConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.selectResults = []
    dbState.deleteArgs = []
  })

  it('returns false when the connection is not found', async () => {
    dbState.selectResults = [[]]
    const ok = await deleteConnection({ id: 'conn_missing', workspaceId: 'ws_A' })
    expect(ok).toBe(false)
    expect(dbState.deleteArgs).toHaveLength(0)
  })

  it('returns true and issues a workspace-scoped delete when found', async () => {
    dbState.selectResults = [[baseRow]]
    const ok = await deleteConnection({ id: 'conn_1', workspaceId: 'ws_A' })
    expect(ok).toBe(true)
    expect(dbState.deleteArgs).toHaveLength(1)
    expect(JSON.stringify(dbState.deleteArgs[0].where)).toContain('conn_1')
    expect(JSON.stringify(dbState.deleteArgs[0].where)).toContain('ws_A')
  })
})

describe('rotateConnectionKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.selectResults = []
    dbState.updateArgs = []
  })

  it('returns null when the connection does not exist for that workspace', async () => {
    dbState.selectResults = [[]] // getConnection returns empty
    const result = await rotateConnectionKey({
      id: 'conn_missing',
      workspaceId: 'ws_A',
      apiKey: 'sk-ant-new',
    })
    expect(result).toBeNull()
    expect(dbState.updateArgs).toHaveLength(0)
  })

  it('encrypts the new key and updates the row workspace-scoped', async () => {
    // Two select results: getConnection before update, getConnection after.
    dbState.selectResults = [[baseRow], [baseRow]]
    await rotateConnectionKey({
      id: 'conn_1',
      workspaceId: 'ws_A',
      apiKey: 'sk-ant-new',
    })
    expect(mockEncryptSecret).toHaveBeenCalledWith('sk-ant-new')
    expect(dbState.updateArgs).toHaveLength(1)
    expect(dbState.updateArgs[0].set.encryptedApiKey).toBe(
      Buffer.from('sk-ant-new').toString('base64')
    )
    expect(JSON.stringify(dbState.updateArgs[0].where)).toContain('conn_1')
    expect(JSON.stringify(dbState.updateArgs[0].where)).toContain('ws_A')
  })

  it('rejects when verify fails and never touches the row', async () => {
    dbState.selectResults = [[baseRow]]
    await expect(
      rotateConnectionKey({
        id: 'conn_1',
        workspaceId: 'ws_A',
        apiKey: 'sk-ant-bad',
        verify: async () => ({ ok: false, error: 'nope' }),
      })
    ).rejects.toThrow('nope')
    expect(dbState.updateArgs).toHaveLength(0)
    expect(mockEncryptSecret).not.toHaveBeenCalled()
  })
})

describe('markVerificationResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.updateArgs = []
  })

  it('records success as lastVerifiedAt=now, error=null', async () => {
    await markVerificationResult({ id: 'conn_1', workspaceId: 'ws_A', ok: true })
    expect(dbState.updateArgs[0].set.lastVerifiedAt).toBeInstanceOf(Date)
    expect(dbState.updateArgs[0].set.lastVerificationError).toBeNull()
  })

  it('records failure as lastVerifiedAt=null with a bounded error string', async () => {
    const bigError = 'e'.repeat(1000)
    await markVerificationResult({
      id: 'conn_1',
      workspaceId: 'ws_A',
      ok: false,
      error: bigError,
    })
    expect(dbState.updateArgs[0].set.lastVerifiedAt).toBeNull()
    expect(dbState.updateArgs[0].set.lastVerificationError).toHaveLength(500)
  })

  it('scopes the update to the workspaceId', async () => {
    await markVerificationResult({ id: 'conn_1', workspaceId: 'ws_A', ok: true })
    expect(JSON.stringify(dbState.updateArgs[0].where)).toContain('ws_A')
  })
})
