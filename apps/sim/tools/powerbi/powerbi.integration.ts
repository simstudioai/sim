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
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { getScopesForService } from '@/lib/oauth/utils'
import { executeSelector } from '@/lib/selectors/application/execute-selector'
import { getSelectorOption } from '@/lib/selectors/application/get-selector-option'
import type { SelectorRequest } from '@/lib/selectors/types'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { executeManualWorkflowOperation } from '@/lib/workflows/application/execute-manual-workflow'
import {
  getExecutionStateForWorkflow,
  getWorkflowExecutionLogStatus,
} from '@/lib/workflows/executor/execution-state'
import {
  installPowerBITransport,
  POWERBI_FIXTURE_IDS,
  POWERBI_FIXTURE_REFRESH_TOKEN,
  POWERBI_FIXTURE_ROTATED_REFRESH_TOKEN,
  POWERBI_FIXTURE_TOKEN,
  startPowerBIProviderFixture,
} from '@/tools/powerbi/__fixtures__/provider-fixture'

const ownerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const credentialId = generateId()
const wrongCredentialId = generateId()
const accountId = generateId()
const wrongAccountId = generateId()
const expiredAccountId = generateId()
const expiredCredentialId = generateId()
const workflowIds: string[] = []
const executionIds: string[] = []
const principal = createSessionPrincipal({ userId: ownerId })
const workflowPrincipal = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  audience: 'sim:workflows',
})
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
let provider: Awaited<ReturnType<typeof startPowerBIProviderFixture>>
let restoreTransport: (() => void) | undefined

vi.hoisted(() => {
  process.env.MICROSOFT_CLIENT_ID = 'powerbi-fixture-client'
  process.env.MICROSOFT_CLIENT_SECRET = 'powerbi-fixture-secret'
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
    name: `Power BI wire acceptance ${workflowId}`,
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
      type: 'powerbi',
      name: operation,
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: operation },
        credential: { id: 'credential', type: 'oauth-input', value: connection },
        workspaceSelector: {
          id: 'workspaceSelector',
          type: 'project-selector',
          value: POWERBI_FIXTURE_IDS.groupId,
        },
        datasetSelector: {
          id: 'datasetSelector',
          type: 'project-selector',
          value: POWERBI_FIXTURE_IDS.datasetId,
        },
        reportSelector: {
          id: 'reportSelector',
          type: 'project-selector',
          value: POWERBI_FIXTURE_IDS.reportId,
        },
        query: { id: 'query', type: 'code', value: 'EVALUATE ROW("Revenue", 125)' },
        includeNulls: { id: 'includeNulls', type: 'switch', value: 'true' },
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

function selector(
  key: 'powerbi.workspaces' | 'powerbi.datasets' | 'powerbi.reports',
  request: SelectorRequest = { kind: 'list' },
  connection = credentialId,
  signal?: AbortSignal
) {
  return executeSelector.execute({
    principal,
    input: {
      selectorKey: key,
      scope: { kind: 'workspace', workspaceId },
      context: {
        oauthCredential: connection,
        ...(key === 'powerbi.workspaces' ? {} : { groupId: POWERBI_FIXTURE_IDS.groupId }),
      },
      request,
      signal,
    },
  })
}

beforeAll(async () => {
  provider = await startPowerBIProviderFixture(http)
  restoreTransport = installPowerBITransport(provider.origin, { http, https, net })
  const now = new Date()
  await db.insert(user).values(
    [ownerId, outsiderId].map((id) => ({
      id,
      name: 'Power BI fixture user',
      email: `${id}@powerbi.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await db
    .insert(workspace)
    .values({ id: workspaceId, name: 'Power BI', ownerId, billedAccountUserId: ownerId })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  for (const [id, providerId, connectionId] of [
    [accountId, 'microsoft-powerbi', credentialId],
    [wrongAccountId, 'microsoft-planner', wrongCredentialId],
    [expiredAccountId, 'microsoft-powerbi', expiredCredentialId],
  ]) {
    await db.insert(account).values({
      id,
      accountId: id,
      providerId,
      userId: ownerId,
      accessToken: id === expiredAccountId ? 'powerbi-expired-access-token' : POWERBI_FIXTURE_TOKEN,
      accessTokenExpiresAt: new Date(
        Date.now() + (id === expiredAccountId ? -60_000 : 24 * 60 * 60 * 1000)
      ),
      ...(id === expiredAccountId
        ? {
            refreshToken: POWERBI_FIXTURE_REFRESH_TOKEN,
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
    await db.delete(user).where(inArray(user.id, [ownerId, outsiderId]))
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
  const reportPath = process.env.POWERBI_REPORT_PATH
  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks, liveProviderCalls: false }, null, 2))
  }
  if (cleanupFailure) throw cleanupFailure
})

describe('Power BI with persisted delegated credentials and provider wire responses', () => {
  it('refreshes an expired delegated token, reuses its stored rotation, and requests the Power BI audience', () =>
    checked('expired delegated token rotation and reuse', async () => {
      const run = await runWorkflow(['powerbi_list_datasets'], undefined, expiredCredentialId)
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      expect(provider.requests).toHaveLength(2)
      expect(provider.requests[0]).toMatchObject({
        method: 'POST',
        path: '/common/oauth2/v2.0/token',
        authorized: true,
        body: { grant_type: 'refresh_token', refresh_token: POWERBI_FIXTURE_REFRESH_TOKEN },
      })
      const tokenBody = provider.requests[0].body as Record<string, string>
      expect(tokenBody.scope.split(' ')[0]).toBe(
        'https://analysis.windows.net/powerbi/api/Workspace.Read.All'
      )
      expect(tokenBody.scope).not.toContain('graph.microsoft.com')
      expect(provider.requests[1].authorized).toBe(true)
      const [stored] = await db.select().from(account).where(eq(account.id, expiredAccountId))
      expect(stored).toMatchObject({
        accessToken: POWERBI_FIXTURE_TOKEN,
        refreshToken: POWERBI_FIXTURE_ROTATED_REFRESH_TOKEN,
      })
      expect(stored.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
      expect(stored.refreshTokenExpiresAt?.getTime()).toBeGreaterThan(
        Date.now() + 89 * 24 * 60 * 60 * 1000
      )
      expect(run.state?.blockStates[run.blockIds[0]]?.output).toMatchObject({ datasetCount: 1 })

      await db
        .update(account)
        .set({ accessTokenExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(account.id, expiredAccountId))
      const beforeRepeatedRefresh = provider.requests.length
      const repeated = await runWorkflow(['powerbi_list_datasets'], undefined, expiredCredentialId)
      expect(provider.requests.slice(beforeRepeatedRefresh)).toEqual([
        {
          method: 'POST',
          path: '/common/oauth2/v2.0/token',
          body: {
            grant_type: 'refresh_token',
            refresh_token: POWERBI_FIXTURE_ROTATED_REFRESH_TOKEN,
            client_id: 'powerbi-fixture-client',
            client_secret: 'powerbi-fixture-secret',
            scope: tokenBody.scope,
          },
          authorized: true,
          status: 200,
        },
        {
          method: 'GET',
          path: `/v1.0/myorg/groups/${POWERBI_FIXTURE_IDS.groupId}/datasets`,
          body: null,
          authorized: true,
          status: 200,
        },
      ])
      expect(repeated.result).toMatchObject({ ok: true, status: 'completed' })
      expect(repeated.state?.blockStates[repeated.blockIds[0]]?.output).toMatchObject({
        datasetCount: 1,
      })
      const [storedAgain] = await db.select().from(account).where(eq(account.id, expiredAccountId))
      expect(storedAgain).toMatchObject({
        accessToken: POWERBI_FIXTURE_TOKEN,
        refreshToken: POWERBI_FIXTURE_ROTATED_REFRESH_TOKEN,
      })
      expect(storedAgain.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
    }))

  it('rejects missing resource identities instead of storing successful null identities', () =>
    checked('malformed identity boundary', async () => {
      provider.setScenario('missing-identity')
      for (const operation of [
        'powerbi_list_workspaces',
        'powerbi_list_reports',
        'powerbi_get_report',
        'powerbi_list_datasets',
        'powerbi_get_dataset',
      ]) {
        const before = provider.requests.length
        const run = await runWorkflow([operation])
        expect(provider.requests.length).toBe(before + 1)
        expect(run.result).toMatchObject({ ok: true, status: 'failed' })
        expect(run.state?.blockLogs.find((log) => log.blockId === run.blockIds[0])?.error).toMatch(
          /Invalid Power BI (workspace|report|semantic model) response: id must be a non-empty string/
        )
      }
    }))

  it('rejects an undocumented empty query response instead of storing successful zero rows', () =>
    checked('malformed query boundary', async () => {
      provider.setScenario('missing-query')
      const run = await runWorkflow(['powerbi_execute_query'])
      expect(run.result).toMatchObject({ ok: true, status: 'failed' })
      expect(run.state?.blockLogs.find((log) => log.blockId === run.blockIds[0])?.error).toContain(
        'Invalid Power BI execute-query response: expected one query result and one table'
      )
    }))

  it('executes all eight actions and retains their normalized outputs in a durable run', () =>
    checked('eight actions and durable outputs', async () => {
      const operations = [
        'powerbi_list_workspaces',
        'powerbi_list_reports',
        'powerbi_get_report',
        'powerbi_list_datasets',
        'powerbi_get_dataset',
        'powerbi_execute_query',
        'powerbi_refresh_dataset',
        'powerbi_get_refresh_history',
      ]
      const run = await runWorkflow(operations)
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      expect(provider.requests).toHaveLength(8)
      expect(provider.requests.every((request) => request.authorized)).toBe(true)
      const root = `/v1.0/myorg/groups/${POWERBI_FIXTURE_IDS.groupId}`
      expect(
        provider.requests.map(({ method, path: requestPath }) => [method, requestPath])
      ).toEqual([
        ['GET', '/v1.0/myorg/groups?%24top=100&%24skip=0'],
        ['GET', `${root}/reports`],
        ['GET', `${root}/reports/${POWERBI_FIXTURE_IDS.reportId}`],
        ['GET', `${root}/datasets`],
        ['GET', `${root}/datasets/${POWERBI_FIXTURE_IDS.datasetId}`],
        ['POST', `${root}/datasets/${POWERBI_FIXTURE_IDS.datasetId}/executeQueries`],
        ['POST', `${root}/datasets/${POWERBI_FIXTURE_IDS.datasetId}/refreshes`],
        ['GET', `${root}/datasets/${POWERBI_FIXTURE_IDS.datasetId}/refreshes?%24top=60`],
      ])
      expect(provider.requests[5].body).toEqual({
        queries: [{ query: 'EVALUATE ROW("Revenue", 125)' }],
        serializerSettings: { includeNulls: true },
      })
      expect(provider.requests[6]).toMatchObject({
        body: { notifyOption: 'NoNotification' },
        status: 202,
      })
      if (!run.state) throw new Error('Run did not persist its execution state')
      const outputs = run.blockIds.map((id) => run.state?.blockStates[id]?.output)
      expect(outputs[0]).toMatchObject({ workspaceCount: 1 })
      expect(outputs[1]).toMatchObject({ reportCount: 1 })
      expect(outputs[2]).toMatchObject({
        report: { id: POWERBI_FIXTURE_IDS.reportId, embedUrl: null },
      })
      expect(outputs[3]).toMatchObject({ datasetCount: 1 })
      expect(outputs[4]).toMatchObject({
        dataset: { id: POWERBI_FIXTURE_IDS.datasetId, isRefreshable: true },
      })
      expect(outputs[5]).toMatchObject({
        rowCount: 1,
        rows: [{ '[Revenue]': 125, 'Sales[Region]': 'West', '[Missing]': null }],
        incomplete: false,
        errors: [],
      })
      expect(outputs[6]).toMatchObject({ accepted: true, requestId: 'fixture-refresh-receipt' })
      expect(outputs[7]).toMatchObject({ refreshCount: 1, refreshes: [{ status: 'Completed' }] })
      expect(JSON.stringify(outputs)).not.toContain(POWERBI_FIXTURE_TOKEN)
      expect(JSON.stringify(outputs)).not.toContain('rawProviderSecret')
    }))

  it('keeps read-only semantic model responses usable when metadata is omitted', () =>
    checked('read-only semantic model projection', async () => {
      provider.setScenario('readonly')
      const run = await runWorkflow(['powerbi_list_datasets', 'powerbi_get_dataset'])
      expect(run.result).toMatchObject({ ok: true, status: 'completed' })
      const output = run.state?.blockStates[run.blockIds[1]]?.output
      expect(output).toMatchObject({
        dataset: {
          id: POWERBI_FIXTURE_IDS.datasetId,
          name: 'Fixture Sales',
          configuredBy: null,
          isRefreshable: null,
        },
      })
    }))

  it.each([
    { handling: 'unhandled', status: 'failed' },
    { handling: 'error port', status: 'completed' },
  ] as const)('uses standard DAX failure outputs with $handling handling', ({ handling, status }) =>
    checked(`standard DAX failure ${handling}`, async () => {
      provider.setScenario('partial-query')
      const consumerId = generateId()
      const configure: ConfigureWorkflowFixture | undefined =
        handling === 'error port'
          ? (state, blockIds) => {
              state.blocks[consumerId] = createBlock({
                id: consumerId,
                type: 'function',
                name: 'Handle query error',
                subBlocks: {
                  language: { id: 'language', type: 'dropdown', value: 'javascript' },
                  code: {
                    id: 'code',
                    type: 'code',
                    value: 'return { error: <powerbi_execute_query.error> };',
                  },
                },
              })
              state.edges.push({
                id: generateId(),
                source: blockIds[0],
                target: consumerId,
                sourceHandle: 'error',
                targetHandle: 'target',
              })
            }
          : undefined
      const run = await runWorkflow(['powerbi_execute_query'], undefined, credentialId, configure)
      expect(run.result).toMatchObject({ ok: true, status })
      expect(provider.requests).toHaveLength(1)
      expect(provider.requests[0]).toMatchObject({ method: 'POST', status: 200 })
      const errorLog = run.state?.blockLogs.find((log) => log.blockId === run.blockIds[0])
      expect(errorLog).toMatchObject({
        success: false,
        error: 'Result was truncated.',
        output: { error: 'Result was truncated.' },
      })
      const actionOutput = run.state?.blockStates[run.blockIds[0]]?.output
      expect(actionOutput).toMatchObject({ error: 'Result was truncated.' })
      for (const field of [
        'rows',
        'rowCount',
        'errors',
        'incomplete',
        'informationProtectionLabel',
      ]) {
        expect(errorLog?.output).not.toHaveProperty(field)
        expect(actionOutput).not.toHaveProperty(field)
      }
      if (handling === 'error port') {
        expect(errorLog?.errorHandled).toBe(true)
        const result = { error: 'Result was truncated.' }
        expect(run.state?.blockLogs.find((log) => log.blockId === consumerId)).toMatchObject({
          success: true,
          output: { result },
        })
        expect(run.state?.blockStates[consumerId]).toMatchObject({
          executed: true,
          output: { result },
        })
      }
    })
  )

  it('projects all selectors safely, hydrates saved IDs, and follows only bounded workspace offsets', () =>
    checked('selector projection and bounded pagination', async () => {
      expect(await selector('powerbi.workspaces')).toEqual({
        kind: 'list',
        items: [{ id: POWERBI_FIXTURE_IDS.groupId, label: 'Fixture Analytics' }],
      })
      expect(await selector('powerbi.datasets')).toEqual({
        kind: 'list',
        items: [{ id: POWERBI_FIXTURE_IDS.datasetId, label: 'Fixture Sales' }],
      })
      expect(await selector('powerbi.reports')).toEqual({
        kind: 'list',
        items: [{ id: POWERBI_FIXTURE_IDS.reportId, label: 'Fixture Revenue' }],
      })
      expect(
        await selector('powerbi.datasets', { kind: 'detail', id: POWERBI_FIXTURE_IDS.datasetId })
      ).toEqual({
        kind: 'detail',
        item: { id: POWERBI_FIXTURE_IDS.datasetId, label: 'Fixture Sales' },
      })
      expect(
        await selector('powerbi.reports', { kind: 'detail', id: POWERBI_FIXTURE_IDS.reportId })
      ).toEqual({
        kind: 'detail',
        item: { id: POWERBI_FIXTURE_IDS.reportId, label: 'Fixture Revenue' },
      })
      provider.setScenario('paged-workspaces')
      const workspaceSelection = {
        selectorKey: 'powerbi.workspaces' as const,
        scope: { kind: 'workspace' as const, workspaceId },
        context: { oauthCredential: credentialId },
      }
      const beforeHydration = provider.requests.length
      expect(
        await getSelectorOption.execute({
          principal,
          input: { ...workspaceSelection, id: POWERBI_FIXTURE_IDS.groupId },
        })
      ).toEqual({ id: POWERBI_FIXTURE_IDS.groupId, label: 'Fixture Analytics' })
      expect(provider.requests.slice(beforeHydration)).toEqual([
        {
          method: 'GET',
          path: `/v1.0/myorg/groups/${POWERBI_FIXTURE_IDS.groupId}`,
          body: null,
          authorized: true,
          status: 200,
        },
      ])
      const deletedWorkspaceId = '44444444-4444-4444-8444-444444444444'
      const beforeDeletedHydration = provider.requests.length
      expect(
        await getSelectorOption.execute({
          principal,
          input: { ...workspaceSelection, id: deletedWorkspaceId },
        })
      ).toBeNull()
      expect(provider.requests.slice(beforeDeletedHydration)).toEqual([
        {
          method: 'GET',
          path: `/v1.0/myorg/groups/${deletedWorkspaceId}`,
          body: null,
          authorized: true,
          status: 404,
        },
      ])
      const first = await selector('powerbi.workspaces')
      expect(first).toMatchObject({ kind: 'list', nextCursor: '100' })
      if (first.kind !== 'list') throw new Error('Expected a selector list')
      expect(first.items).toHaveLength(100)
      const second = await selector('powerbi.workspaces', {
        kind: 'list',
        cursor: first.nextCursor,
      })
      expect(second).toEqual({
        kind: 'list',
        items: [{ id: POWERBI_FIXTURE_IDS.groupId, label: 'Fixture Analytics' }],
      })
      const beforeDenied = provider.requests.length
      for (const cursor of ['https://other.example.test/', '0&$filter=x', '-1', '2147483648']) {
        await expect(selector('powerbi.workspaces', { kind: 'list', cursor })).rejects.toThrow(
          'Context unavailable'
        )
      }
      expect(provider.requests).toHaveLength(beforeDenied)
      provider.setScenario('oversized-workspaces')
      await expect(selector('powerbi.workspaces')).rejects.toThrow('Options unavailable')
    }))

  it('denies another Microsoft service credential and a principal outside the workspace before transport', () =>
    checked('real credential and workspace authorization', async () => {
      await expect(
        selector('powerbi.datasets', { kind: 'list' }, wrongCredentialId)
      ).rejects.toThrow('Connection unavailable')
      const saved = await savedWorkflow(['powerbi_list_datasets'])
      await expect(
        executeManualWorkflowOperation.execute({
          principal: createDelegatedPrincipal({
            subjectUserId: outsiderId,
            workspaceId,
            audience: 'sim:workflows',
          }),
          input: {
            workflowId: saved.workflowId,
            requestId: generateId(),
            input: {},
            mode: 'sync',
            requestHeaders: new Headers(),
            useMockPayload: false,
          },
        })
      ).rejects.toThrow('Insufficient workspace permissions')
      expect(provider.requests).toHaveLength(0)
    }))

  it('turns malformed, oversized, forbidden, and rate-limited provider responses into bounded failures', () =>
    checked('provider failure, response budgets, and socket confinement', async () => {
      // Replace the native dial with a no-I/O delegate so a broken fence cannot contact a provider.
      restoreTransport?.()
      const nativeConnect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
        this: net.Socket
      ) {
        return this
      })
      let restoreFallback: (() => void) | undefined
      try {
        restoreFallback = installPowerBITransport(provider.origin, { http, https, net })
        const local = net.createConnection({
          host: '127.0.0.1',
          port: Number(new URL(provider.origin).port),
        })
        local.destroy()
        expect(nativeConnect).toHaveBeenCalledTimes(1)

        const external = new URL('https://api.powerbi.com/')
        const forgedNormalized = Object.assign([{ host: '127.0.0.1', port: 443 }, null], {
          host: '8.8.8.8',
          port: 443,
        })
        for (const args of [
          [443, '8.8.8.8'],
          [{ host: external.hostname, port: 443 }],
          ['/tmp/powerbi-unexpected-fixture.sock'],
          [forgedNormalized],
        ]) {
          const socket = new net.Socket()
          try {
            expect(() => Reflect.apply(socket.connect, socket, args)).toThrow(
              'Blocked unexpected fixture socket: explicit loopback TCP required'
            )
          } finally {
            socket.destroy()
          }
        }
        expect(nativeConnect).toHaveBeenCalledTimes(1)
      } finally {
        restoreFallback?.()
        nativeConnect.mockRestore()
        restoreTransport = installPowerBITransport(provider.origin, { http, https, net })
      }

      for (const scenario of ['malformed', 'oversized', 'forbidden', 'rate-limited'] as const) {
        provider.setScenario(scenario)
        await expect(selector('powerbi.datasets')).rejects.toThrow(
          scenario === 'forbidden' ? 'Connection unavailable' : 'Options unavailable'
        )
      }
      provider.setScenario('oversized')
      const run = await runWorkflow(['powerbi_list_datasets'])
      expect(run.result).toMatchObject({ ok: true, status: 'failed' })
      const serialized = JSON.stringify(run.state)
      expect(serialized.length).toBeLessThan(64 * 1024)
      expect(serialized).not.toContain(POWERBI_FIXTURE_TOKEN)
    }))

  it('aborts an outstanding selector without returning provider data', () =>
    checked('selector cancellation', async () => {
      provider.setScenario('slow')
      const controller = new AbortController()
      const pending = selector(
        'powerbi.datasets',
        { kind: 'list' },
        credentialId,
        controller.signal
      )
      const poll = setInterval(() => {
        if (provider.requests.length) controller.abort(new Error('Fixture caller cancelled'))
      }, 5)
      try {
        await expect(pending).rejects.toThrow('Fixture caller cancelled')
        expect(provider.requests).toHaveLength(1)
      } finally {
        clearInterval(poll)
      }
    }))
})
