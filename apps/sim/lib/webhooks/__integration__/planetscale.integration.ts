import { resolve } from 'node:path'
import { db } from '@sim/db'
import { webhook, workflowExecutionLogs } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { toRecord } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret } from '@/lib/core/security/encryption'
import { createPlanetScaleAppFixture } from '@/testing/planetscale-app-fixture'

let fixture: Awaited<ReturnType<typeof createPlanetScaleAppFixture>>
const evidence: Record<string, unknown> = {}
const payload = {
  event: 'branch.ready',
  timestamp: 1698252879,
  organization: 'fixture-org',
  database: 'fixture-db',
  resource: {
    id: 'fixture-branch-id',
    name: 'development',
    state: 'ready',
    ready: true,
    production: false,
    safe_migrations: false,
    parent_branch: 'main',
    created_at: '2023-10-25T16:54:12.879Z',
    updated_at: '2023-10-25T16:54:39.820Z',
    html_url: 'https://app.planetscale.com/fixture-org/fixture-db/development',
  },
}

function state(triggerId = 'planetscale_branch_ready', events = ['branch.ready']) {
  const values: Record<string, unknown> = {
    selectedTriggerId: triggerId,
    triggerServiceTokenId: fixture.serviceTokenId,
    triggerServiceToken: fixture.serviceToken,
    triggerOrganization: 'fixture-org',
    triggerDatabaseSelector: 'fixture-db',
    events,
  }
  return {
    blocks: {
      trigger: {
        id: 'trigger',
        type: 'planetscale',
        name: 'PlanetScale',
        position: { x: 0, y: 0 },
        subBlocks: Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            id,
            {
              id,
              type:
                id === 'selectedTriggerId' || id === 'events'
                  ? 'dropdown'
                  : id === 'triggerDatabaseSelector'
                    ? 'file-selector'
                    : 'short-input',
              value,
            },
          ])
        ),
        outputs: {},
        enabled: true,
        triggerMode: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}
async function activeHook() {
  const [row] = await db
    .select()
    .from(webhook)
    .where(
      and(eq(webhook.workflowId, fixture.workflowId), eq(webhook.registrationStatus, 'active'))
    )
  if (!row?.path) throw new Error('Active PlanetScale webhook has no delivery path')
  return { ...row, path: row.path }
}
async function runs() {
  return db
    .select()
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workflowId, fixture.workflowId))
}
async function storedOutput(run: { id: string }) {
  const response = await fixture.request(`/api/logs/${run.id}?workspaceId=${fixture.workspaceId}`)
  expect(response.status, await response.clone().text()).toBe(200)
  const result = await response.json()
  const data = toRecord(result.data.executionData)
  expect(JSON.stringify(data)).not.toContain(fixture.serviceToken)
  expect(JSON.stringify(data)).not.toContain(fixture.serviceTokenId)
  return data.finalOutput
}
async function waitForRuns(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await runs()
    if (rows.length === count && rows.every((row) => row.status === 'completed')) return rows
    if (rows.some((row) => row.status === 'failed'))
      throw new Error(
        `Workflow execution failed: ${JSON.stringify(rows.map((row) => row.executionData))}`
      )
    await sleep(100)
  }
  throw new Error(`Expected ${count} completed workflow executions`)
}

beforeAll(async () => {
  fixture = await createPlanetScaleAppFixture()
}, 240_000)
afterAll(async () => {
  if (!fixture) return
  const report =
    process.env.PLANETSCALE_REPORT_PATH ??
    resolve(process.cwd(), 'test-results/planetscale-http-results.json')
  await fixture.report(report, evidence)
  await fixture.close()
}, 30_000)

describe('PlanetScale triggers through the running authenticated Sim application', () => {
  it('authorizes draft saving and persists the actual trigger fields', async () => {
    const path = `/api/workflows/${fixture.workflowId}/state`
    expect((await fixture.request(path, 'PUT', state(), false)).status).toBe(401)
    const saved = await fixture.request(path, 'PUT', state())
    expect(saved.status, await saved.clone().text()).toBe(200)
    const read = await fixture.request(path)
    expect(read.status).toBe(200)
    const draft = await read.json()
    expect(draft.blocks.trigger.triggerMode).toBe(true)
    expect(draft.blocks.trigger.subBlocks.triggerServiceToken.value).toBe(fixture.serviceToken)
    expect(fixture.remoteHooks.size).toBe(0)
  }, 120_000)

  it('deploys through the outbox and encrypts the provider-generated secret', async () => {
    const response = await fixture.request(
      `/api/workflows/${fixture.workflowId}/deploy`,
      'POST',
      {}
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const result = await response.json()
    expect(result.isDeployed).toBe(true)
    const row = await activeHook()
    const config = row.providerConfig as Record<string, unknown>
    expect(config.triggerServiceTokenId).toBe(fixture.serviceTokenId)
    expect(config.database).toBe('fixture-db')
    expect(config.webhookSecret).not.toBe(fixture.signingSecret)
    expect((await decryptSecret(String(config.webhookSecret))).decrypted).toBe(
      fixture.signingSecret
    )
    expect(fixture.remoteHooks.size).toBe(1)
    expect(fixture.providerRequests.filter((request) => request.method === 'POST')).toHaveLength(1)
    evidence.deployment = {
      status: row.registrationStatus,
      prepared: row.preparedAt !== null,
      encryptedSecret: true,
    }
  }, 120_000)

  it('authenticates probes and deliveries, deduplicates spoofed IDs, and stores real typed workflow output', async () => {
    const row = await activeHook()
    expect(
      (await fixture.deliver(row.path, { ...payload, event: 'webhook.test' }, {}, false)).status
    ).toBe(401)
    expect((await fixture.deliver(row.path, { ...payload, event: 'webhook.test' })).status).toBe(
      200
    )
    expect(
      (await fixture.deliver(row.path, { ...payload, event: 'backup.succeeded' })).status
    ).toBe(200)
    expect(await runs()).toHaveLength(0)
    expect((await fixture.deliver(row.path, payload)).status).toBe(200)
    const first = await waitForRuns(1)
    expect(await storedOutput(first[0])).toEqual({
      event: payload.event,
      timestamp: payload.timestamp,
      organization: payload.organization,
      database: payload.database,
      resource: {
        id: 'fixture-branch-id',
        name: 'development',
        state: 'ready',
        ready: true,
        production: false,
        safeMigrations: false,
        parentBranch: 'main',
        createdAt: payload.resource.created_at,
        updatedAt: payload.resource.updated_at,
        htmlUrl: payload.resource.html_url,
      },
      payload,
    })
    expect(
      (
        await fixture.deliver(row.path, payload, {
          'X-Request-Id': 'spoofed-second-id',
          'X-Sim-Idempotency-Key': 'spoofed-key',
        })
      ).status
    ).toBe(200)
    await sleep(300)
    expect(await runs()).toHaveLength(1)
    expect(
      (await fixture.deliver(row.path, { ...payload, timestamp: payload.timestamp + 1 })).status
    ).toBe(200)
    const repeated = await waitForRuns(2)
    evidence.executionIds = repeated.map((run) => run.executionId)
    evidence.outputs = await Promise.all(repeated.map(storedOutput))
    const accepted = fixture.httpResults.filter(
      (request) => request.path.includes('/api/webhooks/trigger') && request.status === 200
    )
    expect(accepted.every((request) => request.durationMs < 2000)).toBe(true)
  }, 120_000)

  it('recreates only the changed subscription and undeploys through real cleanup', async () => {
    const previous = await activeHook()
    expect(
      (
        await fixture.request(
          `/api/workflows/${fixture.workflowId}/state`,
          'PUT',
          state('planetscale_webhook', ['branch.ready', 'backup.succeeded'])
        )
      ).status
    ).toBe(200)
    const updated = await fixture.request(`/api/workflows/${fixture.workflowId}/deploy`, 'POST', {})
    expect(updated.status, await updated.clone().text()).toBe(200)
    const current = await activeHook()
    expect(current.id).not.toBe(previous.id)
    expect(fixture.remoteHooks.size).toBe(1)
    expect((current.providerConfig as Record<string, unknown>).events).toEqual([
      'branch.ready',
      'backup.succeeded',
    ])
    expect(fixture.providerRequests.filter((request) => request.method === 'POST')).toHaveLength(2)
    expect(
      fixture.providerRequests.some(
        (request) => request.method === 'DELETE' && request.status === 204
      )
    ).toBe(true)
    const backup = {
      ...payload,
      event: 'backup.succeeded',
      timestamp: payload.timestamp + 2,
      resource: {
        id: 'fixture-backup-id',
        name: 'Before deploy',
        state: 'success',
        size: 0,
        protected: false,
        database_branch: { id: 'fixture-branch-id', name: 'main' },
      },
    }
    expect((await fixture.deliver(current.path, backup)).status).toBe(200)
    const genericRuns = await waitForRuns(3)
    const outputs = await Promise.all(genericRuns.map(storedOutput))
    expect(outputs).toContainEqual({ ...backup, payload: backup })
    evidence.genericOutput = outputs.find((output) => toRecord(output).event === backup.event)
    expect(
      (await fixture.deliver(current.path, { ...payload, event: 'branch.sleeping' })).status
    ).toBe(200)
    await sleep(300)
    expect(await runs()).toHaveLength(3)
    const undeployed = await fixture.request(
      `/api/workflows/${fixture.workflowId}/deploy`,
      'DELETE'
    )
    expect(undeployed.status, await undeployed.clone().text()).toBe(200)
    expect(fixture.remoteHooks.size).toBe(0)
    expect((await fixture.deliver(current.path, payload)).status).toBe(404)
    evidence.cleanup = { replaced: true, remainingRemoteSubscriptions: fixture.remoteHooks.size }
  }, 120_000)
})
