/**
 * A dry run on a hosted deployment, against real PostgreSQL and Redis: a write that would use
 * Sim's hosted key is answered with a placeholder before a key is drawn, so the workspace's
 * hosted-key rate-limit counter in Redis is never touched and the recorded request carries no key,
 * while the same run sent for real draws one. Hunter is answered at the tool transport.
 */
import { db } from '@sim/db'
import {
  permissions,
  user,
  userStats,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, SubBlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const HOSTED_KEY = vi.hoisted(() => {
  const key = 'hunter-hosted-fixture-key'
  process.env.HUNTER_API_KEY_COUNT = '1'
  process.env.HUNTER_API_KEY_1 = key
  return key
})

vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env-flags')>()),
  isHosted: true,
}))

import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import * as toolTransport from '@/lib/core/security/input-validation.server'
import { executeManualWorkflowOperation } from '@/lib/workflows/application/execute-manual-workflow'
import type { ExecuteWorkflowServiceRun } from '@/lib/workflows/executor/execute-service'

const ownerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const principal = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  audience: 'sim:workflows',
})

function block(name: string, type: string, values: Record<string, unknown> = {}): BlockState {
  return {
    id: generateId(),
    type,
    name,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        { id: key, type: 'short-input', value: value as SubBlockState['value'] },
      ])
    ),
  }
}

/** Every Redis key that names the fixture workspace: a hosted-key counter is keyed by it. */
async function workspaceRedisKeys(): Promise<string[]> {
  const redis = getRedisClient()
  if (!redis) throw new Error('The suite needs Redis')
  return redis.keys(`*${workspaceId}*`)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Hosted key fixture',
    email: `${ownerId}@dry-run-hosted.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Hosted key fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const start = block('start', 'start_trigger')
  const finder = block('find', 'hunter', {
    operation: 'hunter_email_finder',
    domain: 'example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
  })
  const state: WorkflowState = {
    blocks: { [start.id]: start, [finder.id]: finder },
    edges: [{ id: generateId(), source: start.id, target: finder.id }],
    loops: {},
    parallels: {},
  }
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Hosted key dry run',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, state)
  expect(saved.success, saved.error).toBe(true)
})

afterAll(async () => {
  vi.restoreAllMocks()
  const counters = await workspaceRedisKeys()
  if (counters.length > 0) await getRedisClient()?.del(...counters)
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, workflowId))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, workflowId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await closeRedisConnection()
  await db.$client.end()
})

describe('a dry run on a hosted deployment', () => {
  it('stubs a hosted-key write without drawing a key or counting it against the workspace', async () => {
    expect(await workspaceRedisKeys()).toEqual([])
    const hunterOnly = (url: string) => {
      if (new URL(url).hostname !== 'api.hunter.io') {
        throw new Error(`Unexpected network destination: ${url}`)
      }
    }
    vi.spyOn(toolTransport, 'validateUrlWithDNS').mockImplementation(async (url) => {
      hunterOnly(String(url))
      return { isValid: true, resolvedIP: '203.0.113.1', originalHostname: 'api.hunter.io' }
    })
    const sent = vi
      .spyOn(toolTransport, 'secureFetchWithPinnedIP')
      .mockImplementation(async (url) => {
        hunterOnly(url)
        const response = Response.json({ data: { email: 'ada@example.com', score: 90 } })
        return {
          status: 200,
          statusText: 'OK',
          ok: true,
          url,
          headers: new toolTransport.SecureFetchHeaders({ 'content-type': 'application/json' }),
          body: response.body,
          text: () => response.text(),
          json: () => response.json(),
          arrayBuffer: () => response.arrayBuffer(),
        }
      })
    const run = async (dry: boolean) =>
      (await executeManualWorkflowOperation.execute({
        principal,
        input: {
          workflowId,
          requestId: generateId(),
          executionId: generateId(),
          input: {},
          mode: 'sync',
          requestHeaders: new Headers(),
          sample: false,
          dry,
        },
      })) as ExecuteWorkflowServiceRun

    const result = await run(true)

    expect(result.status, JSON.stringify(result.error)).toBe('completed')
    expect(result.sideEffects?.stubbed).toEqual([
      expect.objectContaining({ block: 'find', tool: 'hunter_email_finder' }),
    ])
    expect(JSON.stringify(result.sideEffects)).not.toContain(HOSTED_KEY)
    expect(await workspaceRedisKeys()).toEqual([])
    expect(sent).not.toHaveBeenCalled()

    const live = await run(false)
    expect(live.status, JSON.stringify(live.error)).toBe('completed')
    expect(sent).toHaveBeenCalledTimes(1)
    expect(await workspaceRedisKeys()).not.toEqual([])
  })
})
