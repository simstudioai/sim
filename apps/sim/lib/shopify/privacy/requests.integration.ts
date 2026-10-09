import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname } from 'node:path'
import { db } from '@sim/db'
import {
  auditLog,
  outboxEvent,
  shopifyInstallationScope,
  shopifyPrivacyRequest,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { decryptSecret } from '@/lib/core/security/encryption'
import { reviewShopifyPrivacyRequest } from '@/lib/shopify/privacy/application/review-request'
import { rememberShopifyInstallationScope } from '@/lib/shopify/privacy/installation-scopes'
import { maintainShopifyPrivacy, shopifyPrivacyOutboxHandlers } from '@/lib/shopify/privacy/outbox'
import { POST } from '@/app/api/webhooks/shopify/privacy/route'

vi.hoisted(() => {
  process.env.SHOPIFY_CLIENT_ID = 'shopify-privacy-fixture-client'
  process.env.SHOPIFY_CLIENT_SECRET = 'shopify-privacy-fixture-secret'
})

const clientId = 'shopify-privacy-fixture-client'
const secret = 'shopify-privacy-fixture-secret'
const shopDomain = `privacy-${generateId()}.myshopify.com`
const shopId = '706405506930370084'
const adminId = generateId()
const memberId = generateId()
const checks: { name: string; status: string; durationMs: number }[] = []
let startedAt = 0
let server: Server
let baseUrl: string

function payload(topic: string): string {
  const customer = ',"customer":{"id":706405506930370085,"email":"privacy-fixture@example.test"}'
  return `{"shop_id":${shopId},"shop_domain":"${shopDomain}"${
    topic === 'shop/redact'
      ? ''
      : `${customer},"${topic === 'customers/redact' ? 'orders_to_redact' : 'orders_requested'}":[706405506930370086]${topic === 'customers/data_request' ? ',"data_request":{"id":706405506930370087}' : ''}`
  }}`
}

async function deliver(
  topic = 'customers/data_request',
  options: { id?: string; body?: string; signature?: string | null } = {}
) {
  const id = options.id ?? generateId()
  const body = options.body ?? payload(topic)
  const signature =
    options.signature === undefined
      ? createHmac('sha256', secret).update(body).digest('base64')
      : options.signature
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-shopify-topic': topic,
    'x-shopify-shop-domain': shopDomain,
    'x-shopify-webhook-id': id,
  }
  if (signature !== null) headers['x-shopify-hmac-sha256'] = signature
  const response = await fetch(baseUrl, { method: 'POST', headers, body })
  return { status: response.status, body: await response.json(), id }
}

beforeAll(async () => {
  await db.insert(user).values(
    [adminId, memberId].map((id) => ({
      id,
      name: 'Privacy fixture',
      email: `${id}@privacy.test`,
      emailVerified: true,
      role: id === adminId ? 'admin' : 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value)
      }
      const result = await POST(
        new NextRequest(baseUrl, { method: 'POST', headers, body: Buffer.concat(chunks) }),
        undefined
      )
      response.writeHead(result.status, Object.fromEntries(result.headers.entries()))
      response.end(await result.text())
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' }).end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Privacy HTTP fixture did not bind')
  baseUrl = `http://127.0.0.1:${address.port}/api/webhooks/shopify/privacy`
})

async function cleanupReceipts() {
  const rows = await db
    .select({ id: shopifyPrivacyRequest.id })
    .from(shopifyPrivacyRequest)
    .where(eq(shopifyPrivacyRequest.clientId, clientId))
  if (!rows.length) return
  await db.delete(outboxEvent).where(
    and(
      eq(outboxEvent.eventType, 'shopify.privacy.received'),
      inArray(
        sql<string>`${outboxEvent.payload}->>'requestId'`,
        rows.map((row) => row.id)
      )
    )
  )
  await db.delete(auditLog).where(
    and(
      eq(auditLog.resourceType, 'privacy_request'),
      inArray(
        auditLog.resourceId,
        rows.map((row) => row.id)
      )
    )
  )
  await db.delete(shopifyPrivacyRequest).where(eq(shopifyPrivacyRequest.clientId, clientId))
}

beforeEach(async () => {
  await cleanupReceipts()
  await db.delete(shopifyInstallationScope).where(eq(shopifyInstallationScope.clientId, clientId))
  startedAt = Date.now()
})

describe('Privacy fulfillment authorization and completion evidence', () => {
  async function requestCase() {
    const receipt = await deliver('shop/redact')
    expect(receipt.status).toBe(200)
    const [row] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.webhookId, receipt.id))
    return row
  }

  function review(
    requestId: string,
    input: Omit<Parameters<typeof reviewShopifyPrivacyRequest.execute>[0]['input'], 'requestId'>,
    userId = adminId
  ) {
    return reviewShopifyPrivacyRequest.execute({
      principal: { kind: 'session', userId, sessionId: 'fixture-session' },
      input: { requestId, ...input },
    })
  }

  it('refuses a nonadministrator even for a known case', async () => {
    const row = await requestCase()
    await expect(review(row.id, { action: 'assign', revision: 0 }, memberId)).rejects.toMatchObject(
      { code: 'forbidden' }
    )
    const [unchanged] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.id, row.id))
    expect(unchanged.assignedToUserId).toBeNull()
  })

  it('requires store evidence and reviewed scope before completion', async () => {
    const row = await requestCase()
    await review(row.id, { action: 'assign', revision: 0 })
    await expect(review(row.id, { action: 'complete', revision: 1 })).rejects.toMatchObject({
      code: 'conflict',
    })
    const [unchanged] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.id, row.id))
    expect(unchanged.completedAt).toBeNull()
  })

  it('does not overwrite a newer operator decision with a stale revision', async () => {
    const row = await requestCase()
    await review(row.id, { action: 'assign', revision: 0 })
    await expect(
      review(row.id, { action: 'record_evidence', revision: 0, evidence: [] })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('records legal retention as unfinished and preserves its evidence', async () => {
    const row = await requestCase()
    await review(row.id, { action: 'assign', revision: 0 })
    await review(row.id, {
      action: 'legal_hold',
      revision: 1,
      evidence: [
        {
          store: 'backups',
          outcome: 'legal_hold',
          recordReference: 'case-record-123',
          summary: 'Synthetic legal requirement with review owner',
        },
      ],
    })
    const [held] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.id, row.id))
    expect(held.status).toBe('legal_hold')
    expect(held.completedAt).toBeNull()
    expect(held.encryptedEvidence).not.toContain('Synthetic legal requirement')
  })

  it('requires reviewed evidence across all storage categories and records the actual operator', async () => {
    const row = await requestCase()
    await review(row.id, { action: 'assign', revision: 0 })
    const stores = [
      'installation_scope',
      'workflow_executions',
      'chats',
      'files',
      'tables',
      'knowledge',
      'saved_workflows',
      'external_processors',
      'backups',
    ] as const
    await review(row.id, {
      action: 'record_evidence',
      revision: 1,
      scopeReviewed: true,
      evidence: stores.map((store) => ({
        store,
        outcome: 'no_data',
        recordReference: `review-${store}`,
        summary: 'Synthetic empty fixture inventory reviewed',
      })),
    })
    await review(row.id, { action: 'complete', revision: 2 })
    const [completed] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.id, row.id))
    expect(completed.status).toBe('completed')
    expect(completed.completedByUserId).toBe(adminId)
    expect(completed.completedAt).toBeInstanceOf(Date)
    expect(completed.encryptedPayload).toBe('')
    const history = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.resourceType, 'privacy_request'), eq(auditLog.resourceId, row.id)))
    expect(history).toHaveLength(3)
    expect(history.every((entry) => entry.actorId === adminId)).toBe(true)
    expect(JSON.stringify(history)).not.toContain('privacy-fixture@example.test')
    expect(JSON.stringify(history)).not.toContain('Synthetic empty fixture inventory')
  })

  it('requires a merchant delivery record for a completed data export', async () => {
    const receipt = await deliver('customers/data_request')
    expect(receipt.status).toBe(200)
    const [row] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.webhookId, receipt.id))
    await review(row.id, { action: 'assign', revision: 0 })
    const stores = [
      'installation_scope',
      'workflow_executions',
      'chats',
      'files',
      'tables',
      'knowledge',
      'saved_workflows',
      'external_processors',
      'backups',
    ] as const
    await review(row.id, {
      action: 'record_evidence',
      revision: 1,
      scopeReviewed: true,
      evidence: stores.map((store) => ({
        store,
        outcome: 'exported',
        recordReference: `export-${store}`,
        summary: 'Synthetic export manifest',
      })),
    })
    await expect(review(row.id, { action: 'complete', revision: 2 })).rejects.toMatchObject({
      code: 'conflict',
    })
    await review(row.id, {
      action: 'record_evidence',
      revision: 2,
      scopeReviewed: true,
      deliveryReference: 'verified-merchant-delivery-record',
      evidence: [
        {
          store: 'installation_scope',
          outcome: 'exported',
          recordReference: 'export-scope',
          summary: 'Synthetic verified delivery',
        },
      ],
    })
    await expect(review(row.id, { action: 'complete', revision: 3 })).resolves.toMatchObject({
      status: 'completed',
    })
  })

  it('rechecks revoked administrator authority before updating a case', async () => {
    const row = await requestCase()
    await review(row.id, { action: 'assign', revision: 0 })
    await db.update(user).set({ role: 'user' }).where(eq(user.id, adminId))
    try {
      await expect(
        review(row.id, { action: 'record_evidence', revision: 1, evidence: [] })
      ).rejects.toMatchObject({ code: 'forbidden' })
    } finally {
      await db.update(user).set({ role: 'admin' }).where(eq(user.id, adminId))
    }
  })

  it('marks an operator case ready after outbox retry without claiming fulfillment', async () => {
    const row = await requestCase()
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(eq(sql`${outboxEvent.payload}->>'requestId'`, row.id))
    await processOutboxEventById(event.id, shopifyPrivacyOutboxHandlers)
    await processOutboxEventById(event.id, shopifyPrivacyOutboxHandlers)
    const [waiting] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.id, row.id))
    expect(waiting.status).toBe('awaiting_review')
    expect(waiting.completedAt).toBeNull()
  })

  it('escalates approaching deadlines without marking a request complete', async () => {
    const row = await requestCase()
    await db
      .update(shopifyPrivacyRequest)
      .set({ dueAt: new Date(Date.now() + 86400000) })
      .where(eq(shopifyPrivacyRequest.id, row.id))
    await maintainShopifyPrivacy()
    const [escalated] = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.id, row.id))
    expect(escalated.escalatedAt).toBeInstanceOf(Date)
    expect(escalated.completedAt).toBeNull()
  })

  it('preserves independent shop ownership while excluding unrelated owners', async () => {
    const credentialId = generateId()
    await rememberShopifyInstallationScope({
      appClientId: clientId,
      shopId,
      shopDomain,
      accountId: generateId(),
      credentialId,
      workspaceId: 'privacy-fixture-owner',
    })
    const rows = await db
      .select()
      .from(shopifyInstallationScope)
      .where(eq(shopifyInstallationScope.credentialId, credentialId))
    expect(rows).toHaveLength(1)
    expect(rows[0].ownerId).toBe('privacy-fixture-owner')
    await expect(
      rememberShopifyInstallationScope({
        appClientId: clientId,
        shopId,
        shopDomain,
        accountId: generateId(),
        credentialId,
        workspaceId: 'privacy-fixture-owner',
        organizationId: 'other-owner',
      })
    ).rejects.toThrow('one canonical owner')
  })
})

afterEach(async (context) => {
  checks.push({
    name: context.task.name,
    status: context.task.result?.state ?? 'unknown',
    durationMs: Date.now() - startedAt,
  })
})

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
  }
  await cleanupReceipts()
  await db.delete(shopifyInstallationScope).where(eq(shopifyInstallationScope.clientId, clientId))
  await db.delete(user).where(inArray(user.id, [adminId, memberId]))
  const reportPath = process.env.SHOPIFY_PRIVACY_REPORT_PATH
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify({ checks }, null, 2)}\n`)
  }
})

describe('Shopify privacy delivery over HTTP and PostgreSQL', () => {
  it.each([null, 'invalid', createHmac('sha256', 'wrong-secret').update('body').digest('base64')])(
    'rejects an unauthenticated delivery without persisting it (%s)',
    async (signature) => {
      const result = await deliver('shop/redact', { signature })
      expect(result.status).toBe(401)
      const rows = await db
        .select({ id: shopifyPrivacyRequest.id })
        .from(shopifyPrivacyRequest)
        .where(eq(shopifyPrivacyRequest.webhookId, result.id))
      expect(rows).toHaveLength(0)
    }
  )

  it.each(['customers/data_request', 'customers/redact', 'shop/redact'])(
    'durably accepts %s without an installed credential and preserves exact identifiers',
    async (topic) => {
      const result = await deliver(topic)
      expect(result.status).toBe(200)
      const [row] = await db
        .select()
        .from(shopifyPrivacyRequest)
        .where(eq(shopifyPrivacyRequest.webhookId, result.id))
      expect(row?.shopId).toBe(shopId)
      expect(row?.status).toBe('received')
      expect(row?.completedAt).toBeNull()
      expect(row?.dueAt.getTime() - row?.receivedAt.getTime()).toBe(30 * 24 * 60 * 60_000)
      expect(row?.encryptedPayload).not.toContain('privacy-fixture@example.test')
      const decoded = await decryptSecret(row.encryptedPayload)
      expect(decoded.decrypted).toBe(payload(topic))
      const events = await db
        .select()
        .from(outboxEvent)
        .where(eq(sql`${outboxEvent.payload}->>'requestId'`, row.id))
      expect(events).toHaveLength(1)
      expect(events[0].payload).toEqual({ requestId: row.id })
    }
  )

  it('collapses concurrent retries into one durable case and work item', async () => {
    const id = generateId()
    const results = await Promise.all(
      Array.from({ length: 8 }, () => deliver('shop/redact', { id }))
    )
    expect(results.map((result) => result.status)).toEqual(Array(8).fill(200))
    const rows = await db
      .select()
      .from(shopifyPrivacyRequest)
      .where(eq(shopifyPrivacyRequest.webhookId, id))
    expect(rows).toHaveLength(1)
    const events = await db
      .select()
      .from(outboxEvent)
      .where(eq(sql`${outboxEvent.payload}->>'requestId'`, rows[0].id))
    expect(events).toHaveLength(1)
  })

  it('does not acknowledge a reused delivery identifier with different authenticated content', async () => {
    const first = await deliver('shop/redact')
    expect(first.status).toBe(200)
    const changed = payload('shop/redact').replace(shopId, '706405506930370099')
    expect((await deliver('shop/redact', { id: first.id, body: changed })).status).toBe(409)
  })

  it('keeps email-only customer requests actionable instead of discarding them', async () => {
    const body = payload('customers/data_request').replace('"id":706405506930370085,', '')
    expect((await deliver('customers/data_request', { body })).status).toBe(200)
  })

  it('deduplicates authenticated content when the unsigned delivery header changes', async () => {
    const body = payload('shop/redact').replace(shopId, '706405506930370088')
    const first = await deliver('shop/redact', { body })
    const second = await deliver('shop/redact', { body })
    expect([first.status, second.status]).toEqual([200, 200])
    const rows = await db
      .select({ id: shopifyPrivacyRequest.id })
      .from(shopifyPrivacyRequest)
      .where(
        and(
          eq(shopifyPrivacyRequest.clientId, clientId),
          eq(shopifyPrivacyRequest.shopId, '706405506930370088')
        )
      )
    expect(rows).toHaveLength(1)
  })

  it('rejects a valid customer payload relabeled as a shop deletion', async () => {
    expect((await deliver('shop/redact', { body: payload('customers/data_request') })).status).toBe(
      400
    )
  })

  it('does not acknowledge a receipt when its atomic outbox insertion fails', async () => {
    await db.execute(sql`CREATE FUNCTION shopify_privacy_fixture_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'shopify.privacy.received' THEN RAISE EXCEPTION 'privacy fixture persistence failure'; END IF;
        RETURN NEW;
      END $$`)
    await db.execute(sql`CREATE TRIGGER shopify_privacy_fixture_reject_outbox BEFORE INSERT ON outbox_event
      FOR EACH ROW EXECUTE FUNCTION shopify_privacy_fixture_reject_outbox()`)
    const id = generateId()
    const body = payload('shop/redact').replace(shopId, '706405506930370089')
    try {
      expect((await deliver('shop/redact', { id, body })).status).toBe(503)
      const rows = await db
        .select({ id: shopifyPrivacyRequest.id })
        .from(shopifyPrivacyRequest)
        .where(eq(shopifyPrivacyRequest.webhookId, id))
      expect(rows).toHaveLength(0)
    } finally {
      await db.execute(sql`DROP TRIGGER shopify_privacy_fixture_reject_outbox ON outbox_event`)
      await db.execute(sql`DROP FUNCTION shopify_privacy_fixture_reject_outbox()`)
    }
    expect((await deliver('shop/redact', { id, body })).status).toBe(200)
  })
})
