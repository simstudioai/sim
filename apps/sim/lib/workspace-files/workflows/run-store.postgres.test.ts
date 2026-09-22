import { readFileSync } from 'node:fs'
import { withUtcTimestamps } from '@sim/db/timestamps'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** Opt in with a disposable localhost database named file_workflow_tests. Never uses DATABASE_URL. */
const testUrl = process.env.FILE_WORKFLOW_TEST_DATABASE_URL
const pool = testUrl ? postgres(testUrl, withUtcTimestamps({ max: 10 })) : null
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const { withUtcTimestamps } = await import('@sim/db/timestamps')
  const url = process.env.FILE_WORKFLOW_TEST_DATABASE_URL
  if (!url) return { db: null }
  const parsed = new URL(url)
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/file_workflow_tests') {
    throw new Error(
      'File workflow integration tests require disposable localhost file_workflow_tests'
    )
  }
  const client = postgres(url, withUtcTimestamps({ max: 10 }))
  return { db: drizzle(client), closeTestDb: () => client.end() }
})

import {
  claimFileWorkflowRun,
  finishFileWorkflowRun,
  readFileWorkflowRun,
  reconcileFileWorkflowRun,
} from '@/lib/workspace-files/workflows/run-store'
import type { FileWorkflowSnapshot } from '@/lib/workspace-files/workflows/types'

const args = {
  fileId: 'file-1',
  workflowId: 'workflow-1',
  executionId: 'run-1',
  audience: 'audience-1',
}
const completed: FileWorkflowSnapshot = {
  status: 'completed',
  executionId: 'run-1',
  deploymentVersionId: 'deployment-1',
  generatedAt: null,
  nextRunAt: null,
  output: null,
  error: null,
}

describe.skipIf(!testUrl)('file workflow PostgreSQL admission and migration', () => {
  beforeAll(async () => {
    if (
      !pool ||
      new URL(testUrl!).hostname !== '127.0.0.1' ||
      new URL(testUrl!).pathname !== '/file_workflow_tests'
    )
      throw new Error('Disposable test database required')
    await pool.unsafe(
      'DROP TABLE IF EXISTS workspace_file_workflow_run, workflow_execution_logs, workspace_files, workflow CASCADE'
    )
    await pool.unsafe(
      'CREATE TABLE workspace_files (id text PRIMARY KEY); CREATE TABLE workflow (id text PRIMARY KEY); CREATE TABLE workflow_execution_logs (execution_id text PRIMARY KEY, status text NOT NULL, ended_at timestamp)'
    )
    await pool.unsafe(
      "INSERT INTO workspace_files VALUES ('file-1'); INSERT INTO workflow VALUES ('workflow-1')"
    )
    await pool.unsafe(
      readFileSync(
        new URL('../../../../../packages/db/migrations/0376_petite_sue_storm.sql', import.meta.url),
        'utf8'
      )
    )
  })
  beforeEach(async () => {
    await pool!.unsafe('TRUNCATE workspace_file_workflow_run, workflow_execution_logs')
  })
  afterAll(async () => {
    await pool?.end()
    const testDb = (await import('@sim/db')) as unknown as { closeTestDb(): Promise<void> }
    await testDb.closeTestDb()
  })

  it('backfills existing files with empty workflow metadata', async () => {
    const rows = await pool!.unsafe(
      'SELECT workflow_ids, workflow_config_version FROM workspace_files'
    )
    expect(rows).toEqual([{ workflow_ids: [], workflow_config_version: 0 }])
  })
  it('admits exactly one of 30 concurrent requests', async () => {
    const admissions = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        claimFileWorkflowRun({ ...args, executionId: `run-${i}` })
      )
    )
    expect(admissions.filter(Boolean)).toHaveLength(1)
  })
  it('retains the cooldown after completion and admits again after five minutes', async () => {
    const first = await claimFileWorkflowRun(args)
    expect(first).not.toBeNull()
    await finishFileWorkflowRun(first!, completed)
    expect(await claimFileWorkflowRun({ ...args, executionId: 'too-soon' })).toBeNull()
    await pool!.unsafe(
      "UPDATE workspace_file_workflow_run SET started_at = now() - interval '301 seconds'"
    )
    expect(await claimFileWorkflowRun({ ...args, executionId: 'run-2' })).toMatchObject({
      executionId: 'run-2',
    })
  })
  it('does not expire an active run or assume a missing log means stopped', async () => {
    await claimFileWorkflowRun(args)
    await pool!.unsafe(
      "UPDATE workspace_file_workflow_run SET started_at = now() - interval '1 day'"
    )
    await reconcileFileWorkflowRun(args.fileId, args.workflowId)
    expect(await claimFileWorkflowRun({ ...args, executionId: 'run-2' })).toBeNull()
  })
  it('allows another attempt after a paused run has a terminal durable log', async () => {
    await claimFileWorkflowRun(args)
    await pool!.unsafe(
      "UPDATE workspace_file_workflow_run SET started_at = now() - interval '301 seconds'; INSERT INTO workflow_execution_logs (execution_id, status) VALUES ('run-1', 'completed')"
    )
    await reconcileFileWorkflowRun(args.fileId, args.workflowId)
    expect(await claimFileWorkflowRun({ ...args, executionId: 'run-2' })).toMatchObject({
      executionId: 'run-2',
    })
  })
  it('fences a delayed completion from overwriting a newer admitted run', async () => {
    const first = await claimFileWorkflowRun(args)
    await finishFileWorkflowRun(first!, completed)
    await pool!.unsafe(
      "UPDATE workspace_file_workflow_run SET started_at = now() - interval '301 seconds'"
    )
    await claimFileWorkflowRun({ ...args, executionId: 'run-2' })
    await finishFileWorkflowRun(first!, completed)
    expect(await readFileWorkflowRun(args.fileId, args.workflowId)).toMatchObject({
      executionId: 'run-2',
      status: 'running',
      deploymentVersionId: null,
    })
  })

  it('reports terminal resumed execution status without changing the durable admission', async () => {
    await claimFileWorkflowRun(args)
    await pool!.unsafe(
      "INSERT INTO workflow_execution_logs (execution_id, status, ended_at) VALUES ('run-1', 'completed', now())"
    )
    expect(await readFileWorkflowRun(args.fileId, args.workflowId)).toMatchObject({
      status: 'completed',
    })
    expect((await pool!.unsafe('SELECT status FROM workspace_file_workflow_run'))[0].status).toBe(
      'running'
    )
    expect(await claimFileWorkflowRun({ ...args, executionId: 'run-2' })).toBeNull()
  })
})
