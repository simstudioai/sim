/**
 * Exercises production run-admission transactions on disposable local PostgreSQL databases.
 * Run with Bun and --tsconfig-override apps/sim/tsconfig.json.
 * MOTHERSHIP_ADMISSION_PROBE_URL must point at localhost/mship_audit_*.
 * The parent creates and drops its own database; a separate Stop process exits before admission.
 * The fixture uses the committed pre-admission snapshot plus migration 0318, with only the
 * user/workspace/chat columns needed for ownership. No provider or deployed service is called.
 */

import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { mock } from 'bun:test'

const root = resolve(import.meta.dir, '../..')
const logger = createLogger('RequestAdmissionProbe')
interface MigrationSnapshot {
  enums: Record<string, { values: string[] }>
  tables: Record<
    string,
    {
      columns: Record<
        string,
        {
          name: string
          type: string
          notNull: boolean
          primaryKey: boolean
          default?: string | number | boolean
        }
      >
    }
  >
}

const child = process.argv.includes('--stop-child')
const databaseUrl = process.env.MOTHERSHIP_ADMISSION_PROBE_URL
if (!databaseUrl)
  throw new Error('MOTHERSHIP_ADMISSION_PROBE_URL must name a disposable local audit database')
const base = new URL(databaseUrl)
if (
  !base.pathname.startsWith('/mship_audit_') ||
  !['localhost', '127.0.0.1'].includes(base.hostname)
)
  throw new Error('Expected local disposable database')
const adminUrl = new URL(base)
adminUrl.pathname = '/postgres'
const admin = child ? null : postgres(adminUrl.toString(), { max: 1, onnotice: () => {} })
const name = child ? base.pathname.slice(1) : `mship_audit_admission_${Date.now()}`
if (admin) await admin`create database ${admin(name)}`
base.pathname = `/${name}`
const client = postgres(base.toString(), { max: 8, onnotice: () => {} })
mock.module(`${root}/packages/db/index.ts`, () => ({ db: drizzle(client) }))
mock.module(`${root}/apps/sim/lib/mothership/request/otel.ts`, () => ({ markSpanForError() {} }))
const repo = await import('@/lib/mothership/async-runs/repository')
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
try {
  if (child) {
    assert.equal(
      await repo.stopPendingRequest({
        userId: 'user-1',
        workspaceId: 'ws-1',
        streamId: 'process-exit',
      }),
      null
    )
  } else {
    const snapshot: MigrationSnapshot = await Bun.file(
      `${root}/packages/db/migrations/meta/0317_snapshot.json`
    ).json()
    for (const enumName of [
      'copilot_run_status',
      'copilot_async_tool_status',
      'copilot_tool_permission_decision',
    ]) {
      await client.unsafe(
        `CREATE TYPE ${quote(enumName)} AS ENUM (${snapshot.enums[`public.${enumName}`].values.map((v: string) => `'${v}'`).join(',')})`
      )
    }
    for (const tableName of ['copilot_runs', 'copilot_async_tool_calls']) {
      const table = snapshot.tables[`public.${tableName}`]
      const columns = Object.values(table.columns).map(
        (column) =>
          `${quote(column.name)} ${column.type}${column.notNull ? ' NOT NULL' : ''}${column.default !== undefined ? ` DEFAULT ${column.default}` : ''}${column.primaryKey ? ' PRIMARY KEY' : ''}`
      )
      await client.unsafe(`CREATE TABLE ${quote(tableName)} (${columns.join(',')})`)
    }
    await client.unsafe('CREATE UNIQUE INDEX test_stream ON copilot_runs(stream_id)')
    await client.unsafe('CREATE UNIQUE INDEX test_tool ON copilot_async_tool_calls(tool_call_id)')
    await client.unsafe(
      'CREATE TABLE "user" (id text PRIMARY KEY); CREATE TABLE workspace (id text PRIMARY KEY); CREATE TABLE copilot_chats (id uuid PRIMARY KEY, user_id text NOT NULL, workspace_id text NOT NULL);'
    )
    await client.unsafe(
      await Bun.file(
        `${root}/packages/db/migrations/0318_mothership_request_stop_admission.sql`
      ).text()
    )
    await client.unsafe(
      "INSERT INTO \"user\" VALUES ('user-1'), ('user-2'); INSERT INTO workspace VALUES ('ws-1'), ('ws-2')"
    )
    const chatId = generateId()
    await client`insert into copilot_chats (id, user_id, workspace_id) values (${chatId}, 'user-1', 'ws-1')`
    const input = (streamId: string, extra = {}) => ({
      streamId,
      userId: 'user-1',
      workspaceId: 'ws-1',
      executionId: `exec-${streamId}`,
      chatId,
      ...extra,
    })
    const scope = (streamId: string, extra = {}) => ({
      streamId,
      userId: 'user-1',
      workspaceId: 'ws-1',
      ...extra,
    })
    for (const status of ['complete', 'error', 'cancelled'] as const) {
      const streamId = `terminal-${status}`
      const run = await repo.createRunSegment(input(streamId))
      const toolCallId = `tool-${streamId}`
      await repo.upsertAsyncToolCall({ runId: run.id, toolCallId, toolName: 'run_code' })
      await repo.updateRunStatus(run.id, status, { completedAt: new Date() })
      assert.equal(
        (await repo.claimSimToolExecution({ runId: run.id, toolCallId, userId: 'user-1' })).outcome,
        'closed'
      )
      await repo.updateRunStatus(run.id, 'paused_waiting_for_tool')
      assert.equal((await repo.getLatestRunForStream(streamId, 'user-1'))?.status, status)
    }
    logger.info('PASS every terminal run refuses late tools and delayed pause events')
    const terminalOwner = await repo.createRunSegment(input('terminal-command-owner'))
    const ownerTool = {
      runId: terminalOwner.id,
      toolCallId: 'terminal-owner-tool',
      userId: 'user-1',
    }
    await repo.upsertAsyncToolCall({
      runId: terminalOwner.id,
      toolCallId: ownerTool.toolCallId,
      toolName: 'run_code',
    })
    assert.equal((await repo.claimSimToolExecution(ownerTool)).outcome, 'claimed')
    const commandIdentity = {
      id: generateId(),
      sandboxId: 'recorded-sandbox',
      sessionKey: 'chat:terminal-owner',
    }
    await repo.recordSimSandboxProcess({ ...ownerTool, process: commandIdentity })
    await repo.updateRunStatus(terminalOwner.id, 'complete', { completedAt: new Date() })
    await assert.rejects(
      repo.recordSimSandboxProcess({
        ...ownerTool,
        process: { ...commandIdentity, id: generateId() },
      })
    )
    assert.equal(
      await repo.areStreamToolExecutionsSettled('terminal-command-owner', 'user-1'),
      false
    )
    await repo.settleSimToolExecution(ownerTool.toolCallId)
    assert.equal(
      await repo.areStreamToolExecutionsSettled('terminal-command-owner', 'user-1'),
      false
    )
    await repo.settleSimSandboxProcess(ownerTool.toolCallId, commandIdentity.id)
    assert.equal(
      await repo.areStreamToolExecutionsSettled('terminal-command-owner', 'user-1'),
      true
    )
    for (let i = 0; i < 30; i++) {
      const streamId = `finish-race-${i}`
      const run = await repo.createRunSegment(input(streamId))
      const tool = { runId: run.id, toolCallId: `tool-${streamId}`, userId: 'user-1' }
      await repo.upsertAsyncToolCall({
        runId: run.id,
        toolCallId: tool.toolCallId,
        toolName: 'run_code',
      })
      const [claim] = await Promise.all([
        repo.claimSimToolExecution(tool),
        repo.updateRunStatus(run.id, 'complete'),
      ])
      assert.equal(
        await repo.areStreamToolExecutionsSettled(streamId, 'user-1'),
        claim.outcome === 'closed'
      )
      if (claim.outcome === 'claimed') await repo.settleSimToolExecution(tool.toolCallId)
      assert.equal(await repo.areStreamToolExecutionsSettled(streamId, 'user-1'), true)
    }
    logger.info(
      'PASS terminal status fences commands without forging handler/process settlement; thirty completion/claim races'
    )
    const createWorkbenchChat = async () => {
      const id = generateId()
      await client`insert into copilot_chats (id, user_id, workspace_id) values (${id}, 'user-1', 'ws-1')`
      return id
    }
    const createWorkbenchTool = async (workbenchChatId: string, streamId: string) => {
      const run = await repo.createRunSegment(input(streamId, { chatId: workbenchChatId }))
      const tool = { runId: run.id, toolCallId: `tool-${streamId}`, userId: 'user-1' }
      await repo.upsertAsyncToolCall({ ...tool, toolName: 'run_code' })
      return tool
    }
    const workbenchChatId = await createWorkbenchChat()
    const sessionKey = `mothership-chat:${workbenchChatId}`
    const prior = await createWorkbenchTool(workbenchChatId, 'workbench-prior')
    assert.equal((await repo.claimSimToolExecution(prior)).outcome, 'claimed')
    const priorCommand = { id: generateId(), sandboxId: 'workbench-vm', sessionKey }
    await repo.recordSimSandboxProcess({ ...prior, process: priorCommand })
    await repo.updateRunStatus(prior.runId, 'complete')
    const current = await createWorkbenchTool(workbenchChatId, 'workbench-current')
    assert.equal((await repo.claimSimToolExecution(current)).outcome, 'claimed')
    const access = { ...current, sessionKey }
    assert.deepEqual(await repo.prepareWorkbenchAccess(access), {
      handlersPending: true,
      processes: [{ ...priorCommand, toolCallId: prior.toolCallId }],
    })
    await repo.settleSimSandboxProcess(prior.toolCallId, priorCommand.id)
    assert.deepEqual(await repo.prepareWorkbenchAccess(access), {
      handlersPending: true,
      processes: [],
    })
    await repo.settleSimToolExecution(prior.toolCallId)
    const ready = { handlersPending: false, processes: [] }
    assert.deepEqual(await repo.prepareWorkbenchAccess(access), ready)
    await assert.rejects(repo.prepareWorkbenchAccess({ ...prior, sessionKey }))
    const sibling = { ...current, toolCallId: 'workbench-sibling' }
    await repo.upsertAsyncToolCall({ ...sibling, toolName: 'run_code' })
    assert.equal((await repo.claimSimToolExecution(sibling)).outcome, 'claimed')
    const siblingCommand = { ...priorCommand, id: generateId() }
    await repo.recordSimSandboxProcess({ ...sibling, process: siblingCommand })
    assert.deepEqual(await repo.prepareWorkbenchAccess(access), ready)
    assert.deepEqual(await repo.prepareWorkbenchAccess({ ...sibling, sessionKey }), ready)
    const emptyNext = await repo.createRunSegment(
      input('workbench-empty-next', { chatId: workbenchChatId })
    )
    assert.deepEqual(await repo.prepareWorkbenchAccess(access), ready)
    assert.equal(
      (await repo.getLatestRunForStream('workbench-empty-next', 'user-1'))?.toolAdmissionClosedAt,
      null
    )
    const neverClaimed = { ...current, toolCallId: 'workbench-never-claimed' }
    await repo.upsertAsyncToolCall({ ...neverClaimed, toolName: 'run_code' })
    await assert.rejects(repo.prepareWorkbenchAccess({ ...neverClaimed, sessionKey }))
    await assert.rejects(repo.prepareWorkbenchAccess({ ...access, userId: 'user-2' }))
    await assert.rejects(repo.prepareWorkbenchAccess({ ...access, sessionKey: 'another-chat' }))
    await repo.settleSimToolExecution(current.toolCallId)
    await assert.rejects(repo.prepareWorkbenchAccess(access))
    await repo.settleSimToolExecution(sibling.toolCallId)
    const nextTool = { runId: emptyNext.id, userId: 'user-1', toolCallId: 'workbench-next-tool' }
    await repo.upsertAsyncToolCall({ ...nextTool, toolName: 'run_code' })
    assert.equal((await repo.claimSimToolExecution(nextTool)).outcome, 'claimed')
    assert.deepEqual(await repo.prepareWorkbenchAccess({ ...nextTool, sessionKey }), {
      handlersPending: false,
      processes: [{ ...siblingCommand, toolCallId: sibling.toolCallId }],
    })
    await repo.settleSimSandboxProcess(sibling.toolCallId, siblingCommand.id)
    assert.deepEqual(await repo.prepareWorkbenchAccess({ ...nextTool, sessionKey }), ready)
    logger.info(
      'PASS workbench recovery requires both receipts; parallel siblings survive; empty newer requests cannot interrupt admission; stale/unclaimed/foreign tools refused'
    )
    for (let i = 0; i < 30; i++) {
      const raceChatId = await createWorkbenchChat()
      const older = await createWorkbenchTool(raceChatId, `workbench-race-old-${i}`)
      const newer = await createWorkbenchTool(raceChatId, `workbench-race-new-${i}`)
      assert.equal((await repo.claimSimToolExecution(newer)).outcome, 'claimed')
      const [claim, state] = await Promise.all([
        repo.claimSimToolExecution(older),
        repo.prepareWorkbenchAccess({ ...newer, sessionKey: `mothership-chat:${raceChatId}` }),
      ])
      assert.deepEqual(state, { handlersPending: claim.outcome === 'claimed', processes: [] })
      assert.equal(
        (await repo.claimSimToolExecution({ ...older, toolCallId: 'late' })).outcome,
        'closed'
      )
      await assert.rejects(
        repo.prepareWorkbenchAccess({ ...older, sessionKey: `mothership-chat:${raceChatId}` })
      )
    }
    logger.info('PASS thirty predecessor-claim/workbench-takeover races without false readiness')
    const corruptChatId = await createWorkbenchChat()
    const corruptOwner = await createWorkbenchTool(corruptChatId, 'workbench-corrupt-owner')
    assert.equal((await repo.claimSimToolExecution(corruptOwner)).outcome, 'claimed')
    const corruptCommand = { id: generateId(), sandboxId: 'foreign', sessionKey: 'another-chat' }
    await repo.recordSimSandboxProcess({ ...corruptOwner, process: corruptCommand })
    const successor = await createWorkbenchTool(corruptChatId, 'workbench-corrupt-successor')
    assert.equal((await repo.claimSimToolExecution(successor)).outcome, 'claimed')
    const successorAccess = { ...successor, sessionKey: `mothership-chat:${corruptChatId}` }
    await assert.rejects(repo.prepareWorkbenchAccess(successorAccess), /does not match this chat/)
    assert.equal(
      (await repo.getLatestRunForStream('workbench-corrupt-owner', 'user-1'))
        ?.toolAdmissionClosedAt,
      null
    )
    await repo.settleSimSandboxProcess(corruptOwner.toolCallId, corruptCommand.id)
    await repo.settleSimToolExecution(corruptOwner.toolCallId)
    await client`update copilot_runs set started_at = '2026-09-01T00:00:00.000001Z' where id = ${corruptOwner.runId}`
    await client`update copilot_runs set started_at = '2026-09-01T00:00:00.000002Z' where id = ${successor.runId}`
    assert.deepEqual(await repo.prepareWorkbenchAccess(successorAccess), ready)
    assert.ok(
      (await repo.getLatestRunForStream('workbench-corrupt-owner', 'user-1'))?.toolAdmissionClosedAt
    )
    logger.info(
      'PASS inconsistent command scope rolls back takeover; admission respects PostgreSQL submillisecond run ordering'
    )
    const proc = Bun.spawn(
      [
        process.execPath,
        '--tsconfig-override',
        `${root}/apps/sim/tsconfig.json`,
        import.meta.path,
        '--stop-child',
      ],
      {
        env: { ...process.env, MOTHERSHIP_ADMISSION_PROBE_URL: base.toString() },
        stdout: 'inherit',
        stderr: 'inherit',
      }
    )
    assert.equal(await proc.exited, 0)
    const delayed = await repo.createRunSegment(input('process-exit'))
    assert.equal(delayed.status, 'cancelled')
    assert.ok(delayed.toolAdmissionClosedAt)
    assert.ok(delayed.completedAt!.getTime() >= delayed.startedAt.getTime())
    assert.equal(await repo.stopPendingRequest(scope('process-exit')), null)
    await assert.rejects(repo.createRunSegment(input('process-exit')))
    await repo.upsertAsyncToolCall({
      runId: delayed.id,
      toolCallId: 'late-tool',
      toolName: 'run_code',
    })
    assert.equal(
      (
        await repo.claimSimToolExecution({
          runId: delayed.id,
          toolCallId: 'late-tool',
          userId: 'user-1',
        })
      ).outcome,
      'closed'
    )
    logger.info(
      'PASS native Stop process exits before admission; durable cancellation, repeat Stop, duplicate refusal and no tool claim'
    )
    await repo.stopPendingRequest(scope('old'))
    await client`update copilot_request_stops set stopped_at = now() - interval '2 days' where stream_id = 'old'`
    const [old] = await client`select stopped_at from copilot_request_stops where stream_id = 'old'`
    await repo.stopPendingRequest(scope('old'))
    const [again] =
      await client`select stopped_at from copilot_request_stops where stream_id = 'old'`
    assert.equal(new Date(old.stopped_at).getTime(), new Date(again.stopped_at).getTime())
    const oldRun = await repo.createRunSegment(input('old', { workspaceId: undefined }))
    assert.equal(oldRun.status, 'cancelled')
    assert.equal(oldRun.workspaceId, 'ws-1')
    assert.ok(oldRun.completedAt!.getTime() >= oldRun.startedAt.getTime())
    logger.info(
      'PASS delayed/repeated Stop retains intent; canonical chat workspace fallback and nonnegative run duration'
    )
    await repo.stopPendingRequest(scope('other-actor', { userId: 'user-2' }))
    assert.equal((await repo.createRunSegment(input('other-actor'))).status, 'active')
    await repo.stopPendingRequest(scope('other-workspace', { workspaceId: 'ws-2' }))
    assert.equal((await repo.createRunSegment(input('other-workspace'))).status, 'active')
    const foreign = await repo.createRunSegment(input('foreign'))
    assert.equal(await repo.stopPendingRequest(scope('foreign', { userId: 'user-2' })), null)
    const existing = await repo.getLatestRunForStream('foreign', 'user-1')
    assert.equal(existing?.status, 'active')
    assert.equal(existing?.toolAdmissionClosedAt, null)
    const wrongScope = await repo.stopPendingRequest(scope('foreign', { workspaceId: 'ws-2' }))
    assert.equal(wrongScope?.id, foreign.id)
    assert.equal(wrongScope?.workspaceId, 'ws-1')
    logger.info(
      'PASS actor/workspace isolation including existing foreign run and asserted-scope race'
    )
    let before = 0
    let after = 0
    for (let i = 0; i < 60; i++) {
      const streamId = `race-${i}`
      const pair =
        i % 2 === 0
          ? Promise.all([
              repo.createRunSegment(input(streamId)),
              repo.stopPendingRequest(scope(streamId)),
            ])
          : Promise.all([
              repo.stopPendingRequest(scope(streamId)),
              repo.createRunSegment(input(streamId)),
            ]).then(([stop, run]) => [run, stop] as const)
      const [run, stop] = await pair
      if (stop === null) {
        before++
        assert.equal(run.status, 'cancelled')
      } else {
        after++
        assert.equal(run.id, stop.id)
        assert.equal(run.status, 'active')
      }
    }
    assert.ok(before > 0 && after > 0)
    logger.info(
      `PASS 60 concurrent Stop/admission races: ${before} cancelled before admission, ${after} returned admitted owner`
    )
    await assert.rejects(
      repo.stopPendingRequest(scope('bad-foreign-key', { workspaceId: 'missing' }))
    )
    const [notRecorded] =
      await client`select count(*)::int as count from copilot_request_stops where stream_id = 'bad-foreign-key'`
    assert.equal(notRecorded.count, 0)
    logger.info('PASS failed durable write rolls back and cannot acknowledge Stop')
  }
} finally {
  await client.end()
  if (admin) {
    await admin`drop database ${admin(name)}`
    await admin.end()
  }
}
