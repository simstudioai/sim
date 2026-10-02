import { mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { db } from '@sim/db'
import {
  account,
  auditLog,
  credential,
  credentialMember,
  idempotencyKey,
  permissions,
  user,
  userStats,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { createBlock } from '@sim/testing/factories/block.factory'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { getScopesForService } from '@/lib/oauth/utils'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { executeManualWorkflowOperation } from '@/lib/workflows/application/execute-manual-workflow'
import {
  getExecutionStateForWorkflow,
  getWorkflowExecutionLogStatus,
} from '@/lib/workflows/executor/execution-state'
import {
  FIGMA_FIXTURE_IDS,
  FIGMA_FIXTURE_REFRESH_TOKEN,
  FIGMA_FIXTURE_TOKEN,
  installFigmaTransport,
  startFigmaProviderFixture,
} from '@/tools/figma/__fixtures__/provider'

const ownerId = generateId()
const workspaceId = generateId()
const credentialId = generateId()
const accountId = generateId()
const expiredAccountId = generateId()
const expiredCredentialId = generateId()
const workflowIds: string[] = []
const executionIds: string[] = []
const workflowPrincipal = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  audience: 'sim:workflows',
})
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
let provider: Awaited<ReturnType<typeof startFigmaProviderFixture>>
let restoreTransport: (() => void) | undefined

vi.hoisted(() => {
  process.env.FIGMA_CLIENT_ID = 'figma-fixture-client'
  process.env.FIGMA_CLIENT_SECRET = 'figma-fixture-secret'
  if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL
})

async function checked(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - started })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - started,
      error: getErrorMessage(error, 'Integration check failed'),
    })
    throw error
  }
}

type ConfigureWorkflowFixture = (state: WorkflowState, blockIds: string[]) => void

async function savedWorkflow(
  operations: string[],
  connection = credentialId,
  configure?: ConfigureWorkflowFixture
) {
  const workflowId = generateId()
  workflowIds.push(workflowId)
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Figma wire acceptance ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const startId = generateId()
  const blocks: WorkflowState['blocks'] = {
    [startId]: createBlock({ id: startId, type: 'start_trigger', name: 'Start' }),
  }
  const edges: WorkflowState['edges'] = []
  const blockIds: string[] = []
  let previousId = startId
  for (const operation of operations) {
    const blockId = generateId()
    blockIds.push(blockId)
    blocks[blockId] = createBlock({
      id: blockId,
      type: 'figma',
      name: `figma_${operation}`,
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: operation },
        credential: { id: 'credential', type: 'oauth-input', value: connection },
        fileKey: { id: 'fileKey', type: 'short-input', value: FIGMA_FIXTURE_IDS.fileKey },
        nodeIds: { id: 'nodeIds', type: 'short-input', value: '12-34,999:99' },
        format: { id: 'format', type: 'dropdown', value: 'png' },
        contentsOnly: { id: 'contentsOnly', type: 'switch', value: 'false' },
        message: { id: 'message', type: 'long-input', value: 'Workflow-authored feedback' },
        commentId: { id: 'commentId', type: 'short-input', value: FIGMA_FIXTURE_IDS.commentId },
      },
    })
    edges.push({ id: generateId(), source: previousId, target: blockId })
    previousId = blockId
  }
  const state: WorkflowState = { blocks, edges, loops: {}, parallels: {} }
  configure?.(state, blockIds)
  const saved = await saveWorkflowToNormalizedTables(workflowId, state)
  expect(saved.success, saved.error).toBe(true)
  return { workflowId, blockIds }
}

async function runWorkflow(
  operations: string[],
  signal?: AbortSignal,
  connection = credentialId,
  configure?: ConfigureWorkflowFixture
) {
  const saved = await savedWorkflow(operations, connection, configure)
  const executionId = generateId()
  executionIds.push(executionId)
  const result = await executeManualWorkflowOperation.execute({
    principal: workflowPrincipal,
    input: {
      workflowId: saved.workflowId,
      requestId: generateId(),
      executionId,
      input: {},
      mode: 'sync',
      requestHeaders: new Headers(),
      useMockPayload: false,
      abortSignal: signal,
    },
  })
  if (result.ok && 'status' in result) {
    const deadline = Date.now() + 10_000
    while ((await getWorkflowExecutionLogStatus(executionId, saved.workflowId)) !== result.status) {
      if (Date.now() >= deadline)
        throw new Error('Run did not persist its terminal log within 10 seconds')
      await sleep(25)
    }
  }
  const state = await getExecutionStateForWorkflow(executionId, saved.workflowId)
  return { ...saved, result, state, executionId }
}

beforeAll(async () => {
  provider = await startFigmaProviderFixture(http)
  restoreTransport = installFigmaTransport(provider.origin, { http, https, net })
  const now = new Date()
  await db.insert(user).values(
    [ownerId].map((id) => ({
      id,
      name: 'Figma fixture user',
      email: `${id}@figma.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await db
    .insert(workspace)
    .values({ id: workspaceId, name: 'Figma', ownerId, billedAccountUserId: ownerId })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  for (const [id, providerId, connectionId] of [
    [accountId, 'figma', credentialId],
    [expiredAccountId, 'figma', expiredCredentialId],
  ]) {
    await db.insert(account).values({
      id,
      accountId: id,
      providerId,
      userId: ownerId,
      accessToken: id === expiredAccountId ? 'figma-expired-access-token' : FIGMA_FIXTURE_TOKEN,
      accessTokenExpiresAt: new Date(
        Date.now() + (id === expiredAccountId ? -60_000 : 24 * 60 * 60 * 1000)
      ),
      ...(id === expiredAccountId
        ? {
            refreshToken: FIGMA_FIXTURE_REFRESH_TOKEN,
            refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          }
        : {}),
      scope: getScopesForService(providerId).join(' '),
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(credential).values({
      id: connectionId,
      workspaceId,
      type: 'oauth',
      displayName: 'Synthetic delegated credential',
      providerId,
      accountId: id,
      createdBy: ownerId,
    })
    await db.insert(credentialMember).values({
      id: generateId(),
      credentialId: connectionId,
      userId: ownerId,
      role: 'admin',
      status: 'active',
      joinedAt: now,
    })
  }
})

beforeEach(() => {
  provider.setScenario('normal')
  provider.requests.length = 0
})

afterAll(async () => {
  let cleanupFailure: Error | undefined
  try {
    if (workflowIds.length) {
      await db
        .delete(workflowExecutionLogs)
        .where(inArray(workflowExecutionLogs.workflowId, workflowIds))
      await db
        .delete(workflowExecutionSnapshots)
        .where(inArray(workflowExecutionSnapshots.workflowId, workflowIds))
      await db.delete(workflow).where(inArray(workflow.id, workflowIds))
    }
    await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    await db.delete(permissions).where(eq(permissions.entityId, workspaceId))
    if (executionIds.length) {
      await db.delete(idempotencyKey).where(
        inArray(
          idempotencyKey.key,
          executionIds.map((id) => `workflow-execution-id:${id}`)
        )
      )
    }
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(inArray(user.id, [ownerId]))
    await rm(path.join(UPLOAD_DIR_SERVER, 'execution', workspaceId), {
      recursive: true,
      force: true,
    })
  } catch (error) {
    checks.push({
      name: 'fixture cleanup',
      status: 'failed',
      durationMs: 0,
      error: getErrorMessage(error, 'Fixture cleanup failed'),
    })
    cleanupFailure = toError(error)
  }
  restoreTransport?.()
  const teardown = await Promise.allSettled([provider?.close(), closeRedisConnection()])
  for (const result of teardown) {
    if (result.status === 'rejected') {
      checks.push({
        name: 'fixture transport teardown',
        status: 'failed',
        durationMs: 0,
        error: getErrorMessage(result.reason, 'Fixture transport teardown failed'),
      })
      cleanupFailure ??= toError(result.reason)
    }
  }
  const reportPath = process.env.FIGMA_REPORT_PATH
  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks, liveProviderCalls: false }, null, 2))
  }
  if (cleanupFailure) throw cleanupFailure
})

describe('Figma actions with real credentials, workflow execution, and stored outputs', () => {
  it('executes all eleven operations and persists documented resource outputs', () =>
    checked('eleven actions and durable outputs', async () => {
      const operations = [
        'get_file_metadata',
        'get_file',
        'get_file_nodes',
        'export_nodes',
        'get_image_fills',
        'list_comments',
        'create_comment',
        'delete_comment',
        'list_file_versions',
        'list_file_components',
        'list_file_styles',
      ]
      const run = await runWorkflow(operations, undefined, credentialId, (state, ids) => {
        for (const field of ['depth', 'scale', 'pageSize']) {
          state.blocks[ids[0]].subBlocks[field] = {
            id: field,
            type: 'short-input',
            value: 'invalid-hidden-value',
          }
        }
      })
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      expect(provider.requests).toHaveLength(11)
      expect(provider.requests.every((entry) => entry.authorized)).toBe(true)
      const outputs = run.blockIds.map((id) => run.state?.blockStates[id]?.output)
      expect(outputs[0]).toMatchObject({
        file: {
          name: 'Fixture Design',
          creator: { id: FIGMA_FIXTURE_IDS.userId },
          folder_name: null,
        },
      })
      expect(outputs[1]).toMatchObject({
        document: { id: '0:0', children: [{ id: '12:34', visible: false }] },
        branches: [],
      })
      expect(outputs[2]).toMatchObject({
        nodes: { '999:99': null, '12:34': { document: { id: '12:34' } } },
      })
      expect(outputs[3]).toMatchObject({
        images: { '12:34': 'https://example.test/export.png', '999:99': null },
      })
      expect(outputs[4]).toMatchObject({ images: { imageRef: 'https://example.test/fill.png' } })
      expect(outputs[5]).toMatchObject({
        comments: [{ id: FIGMA_FIXTURE_IDS.commentId, parent_id: null, reactions: [] }],
      })
      expect(outputs[6]).toMatchObject({ comment: { message: 'Workflow-authored feedback' } })
      expect(outputs[7]).toEqual({ deleted: true })
      expect(outputs[8]).toMatchObject({
        versions: [{ id: FIGMA_FIXTURE_IDS.versionId, label: null }],
        pagination: { prev_page: null },
      })
      expect(outputs[9]).toMatchObject({
        components: [{ containing_frame: { pageId: '0:1', name: null } }],
      })
      expect(outputs[10]).toMatchObject({ styles: [{ style_type: 'FILL', sort_position: '0' }] })
      expect(provider.requests[3].path).toContain('contents_only=false')
      expect(JSON.stringify(outputs)).not.toContain(FIGMA_FIXTURE_TOKEN)
    }))

  it('keeps empty collections usable without fabricating pagination', () =>
    checked('empty resources', async () => {
      provider.setScenario('empty')
      const run = await runWorkflow([
        'get_image_fills',
        'list_comments',
        'list_file_versions',
        'list_file_components',
        'list_file_styles',
      ])
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      expect(run.state?.blockStates[run.blockIds[0]]?.output).toEqual({ images: {} })
      expect(run.state?.blockStates[run.blockIds[1]]?.output).toEqual({ comments: [] })
      expect(run.state?.blockStates[run.blockIds[2]]?.output).toEqual({
        versions: [],
        pagination: { prev_page: null, next_page: null },
      })
      expect(run.state?.blockStates[run.blockIds[3]]?.output).toEqual({ components: [] })
      expect(run.state?.blockStates[run.blockIds[4]]?.output).toEqual({ styles: [] })
    }))

  it('preserves version cursors and dynamic node IDs after workflow reference resolution', () =>
    checked('dynamic references and version pagination', async () => {
      const run = await runWorkflow(
        ['get_file', 'get_file_nodes', 'list_file_versions'],
        undefined,
        credentialId,
        (state, ids) => {
          state.blocks[ids[1]].subBlocks.nodeIds.value = '<figma_get_file.document.children.0.id>'
          state.blocks[ids[2]].subBlocks.before = {
            id: 'before',
            type: 'short-input',
            value: `<figma_get_file.version>`,
          }
          state.blocks[ids[2]].subBlocks.pageSize = {
            id: 'pageSize',
            type: 'short-input',
            value: '50',
          }
        }
      )
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      expect(provider.requests[1].path).toContain('ids=12%3A34')
      expect(provider.requests[2].path).toContain(`before=${FIGMA_FIXTURE_IDS.versionId}`)
      expect(provider.requests[2].path).toContain('page_size=50')
    }))

  it('refreshes an expired token through the shared coordinator and retains the reusable refresh token', () =>
    checked('real credential refresh persistence', async () => {
      const run = await runWorkflow(['get_file_metadata'], undefined, expiredCredentialId)
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      expect(provider.requests[0]).toMatchObject({
        method: 'POST',
        path: '/v1/oauth/refresh',
        authorized: true,
        body: { refresh_token: FIGMA_FIXTURE_REFRESH_TOKEN },
      })
      const [stored] = await db.select().from(account).where(eq(account.id, expiredAccountId))
      expect(stored).toMatchObject({
        accessToken: FIGMA_FIXTURE_TOKEN,
        refreshToken: FIGMA_FIXTURE_REFRESH_TOKEN,
      })
      expect(stored.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
    }))

  it.each(['forbidden', 'in-band-error', 'malformed', 'oversized', 'rate-limited'] as const)(
    'fails safely for %s provider responses',
    (scenario) =>
      checked(`failure ${scenario}`, async () => {
        provider.setScenario(scenario)
        const run = await runWorkflow(['get_file_metadata'])
        expect(run.result).toMatchObject({ ok: true, status: 'failed' })
        expect(run.state?.blockStates[run.blockIds[0]]?.output).toHaveProperty('error')
        if (scenario === 'in-band-error') {
          expect(run.state?.blockStates[run.blockIds[0]]?.output).toEqual({
            error: 'Fixture permission denied',
          })
        }
        expect(run.state?.blockStates[run.blockIds[0]]?.output).not.toHaveProperty('file')
        expect(JSON.stringify(run.state?.blockLogs)).not.toContain(FIGMA_FIXTURE_TOKEN)
      })
  )

  it('routes the canonical provider error to a downstream error-port handler', () =>
    checked('standard error-port handling', async () => {
      provider.setScenario('in-band-error')
      const consumerId = generateId()
      const run = await runWorkflow(
        ['get_file_metadata'],
        undefined,
        credentialId,
        (state, ids) => {
          state.blocks[consumerId] = createBlock({
            id: consumerId,
            type: 'function',
            name: 'Handle error',
            subBlocks: {
              language: { id: 'language', type: 'dropdown', value: 'javascript' },
              code: {
                id: 'code',
                type: 'code',
                value: 'return { error: <figma_get_file_metadata.error> };',
              },
            },
          })
          state.edges.push({
            id: generateId(),
            source: ids[0],
            target: consumerId,
            sourceHandle: 'error',
            targetHandle: 'target',
          })
        }
      )
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      expect(run.state?.blockStates[run.blockIds[0]]?.output).toEqual({
        error: 'Fixture permission denied',
      })
      expect(run.state?.blockStates[consumerId]?.output).toMatchObject({
        result: { error: 'Fixture permission denied' },
      })
    }))

  it('cancels an in-flight native request without waiting for the provider', () =>
    checked('native transport cancellation', async () => {
      provider.setScenario('slow')
      const controller = new AbortController()
      const pending = runWorkflow(['get_file_metadata'], controller.signal)
      const deadline = Date.now() + 5000
      while (!provider.requests.length) {
        if (Date.now() > deadline) throw new Error('Request did not reach fixture')
        await sleep(10)
      }
      controller.abort()
      const run = await pending
      expect(run.result).toMatchObject({ ok: true, status: 'cancelled' })
    }))
})
