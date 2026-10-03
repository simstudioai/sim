import { createHash } from 'node:crypto'
import * as audit from '@sim/audit'
import { AuditAction } from '@sim/audit'
import { db } from '@sim/db'
import { auditLog, organization, user, workspace } from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrgScopeCondition } from '@/lib/audit-logs/query'
import { initializeSessionFileProvenance } from '@/lib/execution/remote-sandbox/session-file-provenance'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

const redisUrl = readTestRedisUrl()
const redis = redisUrl
  ? new Redis(redisUrl, {
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    })
  : undefined
redis?.on('error', () => {})
const receiptPrefixes = new Set<string>()
const historyKeys = new Set<string>()
const fixtureWorkspaceId = generateShortId()
const fixtureUserId = generateShortId()
let scope = { workspaceId: fixtureWorkspaceId, userId: fixtureUserId, sessionKey: 'chat' }
let submittedAudits = 0
let restoreAuditObservation: (() => void) | undefined
const machine = { providerId: 'e2b', sandboxId: 'physical-machine' } as const
const bytes = new Uint8Array([255, 254, 0, 1, 90, 13, 10])
const secret: WorkspaceFileSecretProvenance = {
  status: 'exact',
  entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'reader' }],
}
const safe: WorkspaceFileSecretProvenance = { status: 'exact', entries: [] }
const body = (content = bytes) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(content)
      controller.close()
    },
  })
const consume = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer())

async function download(provenance: WorkspaceFileSecretProvenance = secret) {
  const invocation = createWorkbenchFileProvenance(scope)
  const stream = body()
  invocation.trackDownload(stream, provenance)
  expect(await consume(invocation.observeDownload(machine, stream))).toEqual(bytes)
}

function receiptPrefix(currentScope: {
  workspaceId?: string
  organizationId?: string
  userId: string
  sessionKey: string
}) {
  const namespace = createHash('sha256')
    .update(
      JSON.stringify([
        currentScope.organizationId
          ? { organizationId: currentScope.organizationId }
          : currentScope.workspaceId,
        currentScope.userId,
        currentScope.sessionKey,
        machine.providerId,
        machine.sandboxId,
      ])
    )
    .digest('hex')
  const prefix = `mothership:file-source:${currentScope.organizationId ? 'v2' : 'v1'}:${namespace}`
  receiptPrefixes.add(prefix)
  return prefix
}

/** Waits for real fire-and-forget audit writes before inspecting or removing fixture rows. */
async function settledWorkspaceAudits() {
  const read = () => db.select().from(auditLog).where(eq(auditLog.workspaceId, fixtureWorkspaceId))
  await vi.waitFor(async () => expect(await read()).toHaveLength(submittedAudits))
  return read()
}

beforeAll(async () => {
  if (!redis) return
  await redis.connect()
  await db.insert(user).values({
    id: fixtureUserId,
    name: 'Receipt test actor',
    email: `${fixtureUserId}@fixture.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(workspace).values({
    id: fixtureWorkspaceId,
    name: 'Receipt test workspace',
    ownerId: fixtureUserId,
    billedAccountUserId: fixtureUserId,
  })
  const recordAudit = audit.recordAudit
  const observation = vi.spyOn(audit, 'recordAudit').mockImplementation((entry) => {
    if (entry.workspaceId === fixtureWorkspaceId) submittedAudits += 1
    recordAudit(entry)
  })
  restoreAuditObservation = () => observation.mockRestore()
})
beforeEach(() => {
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis ?? null)
  scope = { ...scope, sessionKey: `chat-${generateShortId(16)}` }
  receiptPrefix(scope)
  historyKeys.add(
    `mothership:workbench-provenance:v2:${createHash('sha256')
      .update(JSON.stringify([scope.sessionKey, machine.providerId, machine.sandboxId]))
      .digest('hex')}`
  )
})
afterEach(async () => {
  if (!redis) return
  await settledWorkspaceAudits()
  await db.delete(auditLog).where(eq(auditLog.workspaceId, fixtureWorkspaceId))
  submittedAudits = 0
})
afterAll(async () => {
  if (!redis) return
  try {
    for (const prefix of receiptPrefixes) {
      let cursor = '0'
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 100)
        cursor = next
        if (keys.length > 0) await redis.del(...keys)
      } while (cursor !== '0')
    }
    if (historyKeys.size > 0) await redis.del(...historyKeys)
    await db.delete(auditLog).where(eq(auditLog.workspaceId, fixtureWorkspaceId))
    await db.delete(workspace).where(eq(workspace.id, fixtureWorkspaceId))
    await db.delete(user).where(eq(user.id, fixtureUserId))
  } finally {
    restoreAuditObservation?.()
    await Promise.all([redis.quit(), db.$client.end()])
  }
})

describe.skipIf(!redisUrl)('trusted workbench byte receipts with real Redis', () => {
  it.each(['complete', 'pending sibling', 'unknown'] as const)(
    'persists settled stdout evidence from a %s registry',
    async (state) => {
      const registry = new ResolvedSecretTraceRegistry([], scope)
      if (state === 'unknown') registry.markIncomplete('workspace-file-provenance-unknown')
      const settle = state === 'pending sibling' ? registry.beginPendingActivation() : undefined
      const invocation = createWorkbenchFileProvenance({
        ...scope,
        resolvedSecretTraceRegistry: registry,
      })
      const value = 'saved command output'
      try {
        const observe = await invocation.observeOutput(value)
        await consume(observe(machine, new Blob([value]).stream()))
        const next = createWorkbenchFileProvenance(scope)
        await consume(next.observeUpload(machine, new Blob([value]).stream()))
        expect(next.uploadProvenance()).toEqual(state === 'unknown' ? { status: 'unknown' } : safe)
      } finally {
        settle?.()
      }
    }
  )
  it('keeps a large safe transfer streamed and readable across invocations', async () => {
    const size = 6 * 1024 * 1024 + 17
    const chunk = new Uint8Array(64 * 1024).fill(255)
    const source = () => {
      let remaining = size
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!remaining) {
            controller.close()
            return
          }
          const length = Math.min(remaining, chunk.length)
          remaining -= length
          controller.enqueue(chunk.subarray(0, length))
        },
      })
    }
    const count = async (stream: ReadableStream<Uint8Array>) => {
      let received = 0
      await stream.pipeTo(
        new WritableStream({
          write(value) {
            received += value.byteLength
          },
        })
      )
      expect(received).toBe(size)
    }
    const first = createWorkbenchFileProvenance(scope)
    const stream = source()
    first.trackDownload(stream, safe)
    await count(first.observeDownload(machine, stream))
    const next = createWorkbenchFileProvenance(scope)
    await count(next.observeUpload(machine, source()))
    expect(next.uploadProvenance()).toEqual(safe)
  })
  it.each([secret, safe, { status: 'unknown' } as const])(
    'survives a fresh invocation: %j',
    async (source) => {
      await download(source)
      const next = createWorkbenchFileProvenance(scope)
      expect(() => next.uploadProvenance()).toThrow('has not finished')
      expect(await consume(next.observeUpload(machine, body()))).toEqual(bytes)
      expect(next.uploadProvenance()).toEqual(source)
    }
  )

  it('classifies changed bytes as unknown without poisoning an unchanged safe copy', async () => {
    await download(safe)
    const changed = createWorkbenchFileProvenance(scope)
    await consume(changed.observeUpload(machine, body(new Uint8Array([0]))))
    expect(changed.uploadProvenance()).toEqual({ status: 'unknown' })
    const unchanged = createWorkbenchFileProvenance(scope)
    await consume(unchanged.observeUpload(machine, body()))
    expect(unchanged.uploadProvenance()).toEqual(safe)
  })

  it.each(['workspaceId', 'userId', 'sessionKey', 'sandboxId', 'providerId'] as const)(
    'isolates receipts by %s when machine history is unavailable',
    async (field) => {
      await download()
      await redis!.del(...historyKeys)
      const next = createWorkbenchFileProvenance({
        ...scope,
        ...(['workspaceId', 'userId', 'sessionKey'].includes(field) ? { [field]: 'other' } : {}),
      })
      await consume(
        next.observeUpload(
          {
            ...machine,
            ...(field === 'sandboxId' ? { sandboxId: 'replacement' } : {}),
            ...(field === 'providerId' ? { providerId: 'daytona' as const } : {}),
          },
          body()
        )
      )
      expect(next.uploadProvenance()).toEqual({ status: 'unknown' })
    }
  )

  it.each([
    ['unrecorded then empty', { status: 'unrecorded' }, safe, safe],
    ['empty then unrecorded', safe, { status: 'unrecorded' }, safe],
    ['unrecorded then known', { status: 'unrecorded' }, secret, secret],
    ['known then unrecorded', secret, { status: 'unrecorded' }, secret],
    [
      'unrecorded then unknown',
      { status: 'unrecorded' },
      { status: 'unknown' },
      { status: 'unknown' },
    ],
    [
      'unknown then unrecorded',
      { status: 'unknown' },
      { status: 'unrecorded' },
      { status: 'unknown' },
    ],
  ] as const)(
    'preserves recorded evidence for identical bytes: %s',
    async (_label, first, second, expected) => {
      await download(first)
      await download(second)
      const next = createWorkbenchFileProvenance(scope)
      expect(await consume(next.observeUpload(machine, body()))).toEqual(bytes)
      expect(next.uploadProvenance()).toEqual(expected)
    }
  )

  it('concurrent conflicting receipts cannot overwrite unknown with safe', async () => {
    await Promise.all([download(safe), download({ status: 'unknown' }), download(secret)])
    await download(safe)
    const next = createWorkbenchFileProvenance(scope)
    await consume(next.observeUpload(machine, body()))
    expect(next.uploadProvenance()).toEqual({ status: 'unknown' })
  })

  it('parallel independent streams keep their own classification', async () => {
    const invocation = createWorkbenchFileProvenance(scope)
    const first = body()
    const second = body(new Uint8Array([1]))
    invocation.trackDownload(first, secret)
    invocation.trackDownload(second, safe)
    await Promise.all([
      consume(invocation.observeDownload(machine, first)),
      consume(invocation.observeDownload(machine, second)),
    ])
    const next = createWorkbenchFileProvenance(scope)
    await consume(next.observeUpload(machine, body()))
    expect(next.uploadProvenance()).toEqual(secret)
    const other = createWorkbenchFileProvenance(scope)
    await consume(other.observeUpload(machine, body(new Uint8Array([1]))))
    expect(other.uploadProvenance()).toEqual(safe)
  })

  it('cannot complete from a partially consumed or failed stream', async () => {
    const invocation = createWorkbenchFileProvenance(scope)
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
      },
      pull(controller) {
        controller.error(new Error('transfer failed'))
      },
    })
    await expect(consume(invocation.observeUpload(machine, failing))).rejects.toThrow(
      'transfer failed'
    )
    expect(() => invocation.uploadProvenance()).toThrow('has not finished')
  })

  it('Stop makes even a fully read source unavailable for completion', async () => {
    await download()
    const controller = new AbortController()
    const invocation = createWorkbenchFileProvenance({ ...scope, signal: controller.signal })
    await consume(invocation.observeUpload(machine, body()))
    controller.abort(new Error('stopped'))
    expect(() => invocation.uploadProvenance()).toThrow('stopped')
  })

  it('missing history and present invalid receipts never certify bytes safe', async () => {
    const next = createWorkbenchFileProvenance(scope)
    await consume(next.observeUpload(machine, body()))
    expect(next.uploadProvenance()).toEqual({ status: 'unknown' })
    await initializeSessionFileProvenance(scope.sessionKey, machine)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const key = `${receiptPrefix(scope)}:${digest}`
    for (const value of [
      'broken JSON',
      JSON.stringify({
        version: 1,
        workspaceId: scope.workspaceId,
        provenance: { status: 'unknown' },
      }),
    ]) {
      await redis!.set(key, value, 'EX', 60)
      const broken = createWorkbenchFileProvenance(scope)
      await consume(broken.observeUpload(machine, body()))
      expect(broken.uploadProvenance()).toEqual({ status: 'unknown' })
    }
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
    const unavailable = createWorkbenchFileProvenance(scope)
    await expect(consume(unavailable.observeUpload(machine, body()))).rejects.toThrow(
      'storage is unavailable'
    )
    expect(() => unavailable.uploadProvenance()).toThrow('has not finished')
  })

  it.each([
    'complete',
    'source failure',
    'cancel',
    'abort',
    'storage failure',
    'abort during persistence',
  ] as const)('audits unrecorded downloads only after acceptance: %s', async (outcome) => {
    const stop = new AbortController()
    let producer!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        producer = controller
        controller.enqueue(bytes)
      },
    })
    const invocation = createWorkbenchFileProvenance({ ...scope, signal: stop.signal })
    invocation.trackDownload(stream, { status: 'unrecorded' })
    const reader = invocation.observeDownload(machine, stream).getReader()
    try {
      expect(await reader.read()).toEqual({ done: false, value: bytes })
      expect(await settledWorkspaceAudits()).toEqual([])
      if (outcome === 'cancel') {
        await reader.cancel()
      } else if (outcome === 'source failure') {
        producer.error(new Error('transfer failed'))
        await expect(reader.read()).rejects.toThrow('transfer failed')
      } else if (outcome === 'abort') {
        stop.abort(new Error('stopped'))
        await expect(reader.read()).rejects.toThrow('stopped')
      } else {
        if (outcome === 'storage failure') {
          redisConfigMockFns.mockGetRedisClient.mockReturnValueOnce(null)
        } else if (outcome === 'abort during persistence') {
          redisConfigMockFns.mockGetRedisClient.mockImplementationOnce(() => {
            stop.abort(new Error('stopped during persistence'))
            return redis!
          })
        }
        producer.close()
        if (outcome === 'complete') {
          expect(await reader.read()).toEqual({ done: true, value: undefined })
        } else {
          await expect(reader.read()).rejects.toThrow(
            outcome === 'storage failure' ? 'storage is unavailable' : 'stopped during persistence'
          )
        }
      }
      if (outcome === 'abort during persistence') {
        /** Cancellation rejects the reader before the already-issued receipt write settles. */
        await redis!.ping()
        await flushMacrotask()
      }
      const entries = await settledWorkspaceAudits()
      expect(entries).toHaveLength(outcome === 'complete' ? 1 : 0)
      if (outcome === 'complete') {
        expect(entries[0]).toMatchObject({
          action: AuditAction.SECRET_PROVENANCE_UNRECORDED,
          actorId: fixtureUserId,
          workspaceId: fixtureWorkspaceId,
        })
        const next = createWorkbenchFileProvenance(scope)
        await consume(next.observeUpload(machine, body()))
        expect(next.uploadProvenance()).toEqual({ status: 'unrecorded' })
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  })

  it('records accepted organization bytes in the owning organization audit scope', async () => {
    const organizationId = generateShortId()
    const userId = generateShortId()
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Receipt audit fixture', slug: organizationId })
    await db.insert(user).values({
      id: userId,
      name: 'Receipt audit actor',
      email: `${userId}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    try {
      const orgScope = { organizationId, userId, sessionKey: scope.sessionKey }
      receiptPrefix(orgScope)
      const invocation = createWorkbenchFileProvenance(orgScope)
      const stream = body()
      invocation.trackDownload(stream, { status: 'unrecorded' })
      expect(await consume(invocation.observeDownload(machine, stream))).toEqual(bytes)
      const query = (owner: string) =>
        db
          .select({
            workspaceId: auditLog.workspaceId,
            actorId: auditLog.actorId,
            metadata: auditLog.metadata,
          })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.action, AuditAction.SECRET_PROVENANCE_UNRECORDED),
              buildOrgScopeCondition({
                organizationId: owner,
                orgWorkspaceIds: [],
                orgMemberIds: [userId],
                includeDeparted: false,
              })
            )
          )
      await expect.poll(() => query(organizationId)).toHaveLength(1)
      expect(await query(organizationId)).toEqual([
        {
          workspaceId: null,
          actorId: userId,
          metadata: { surface: 'workspace-file', organizationId },
        },
      ])
      expect(await query(generateShortId())).toEqual([])
    } finally {
      await db.delete(auditLog).where(eq(auditLog.actorId, userId))
      await db.delete(user).where(eq(user.id, userId))
      await db.delete(organization).where(eq(organization.id, organizationId))
    }
  })

  it('shares an org chat receipt across explicit targets but never across orgs or chats', async () => {
    const orgScope = { ...scope, organizationId: 'org', workspaceId: 'a' }
    receiptPrefix(orgScope)
    const first = createWorkbenchFileProvenance(orgScope)
    const stream = body()
    first.trackDownload(stream, safe)
    await consume(first.observeDownload(machine, stream))
    const second = createWorkbenchFileProvenance({ ...orgScope, workspaceId: 'b' })
    await consume(second.observeUpload(machine, body()))
    expect(second.uploadProvenance()).toEqual(safe)
    for (const other of [
      { ...orgScope, organizationId: 'other' },
      { ...orgScope, sessionKey: 'other' },
    ]) {
      const outsider = createWorkbenchFileProvenance(other)
      await consume(outsider.observeUpload(machine, body()))
      expect(outsider.uploadProvenance()).toEqual({ status: 'unknown' })
    }
  })
})
