import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { db } from '@sim/db'
import {
  apiKey,
  permissions,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
  workspaceOperationReceipt,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashApiKey } from '@/lib/api-key/crypto'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { workflowDeploymentOutboxHandlers } from '@/lib/workflows/deployment-outbox'
import { performFullDeploy } from '@/lib/workflows/orchestration/deploy'
import { workspaceOperationOutboxHandlers } from '@/lib/workspaces/operations/outbox'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'
import { GET as logGet } from '@/app/api/v2/logs/[runId]/route'
import { POST as importPreview } from '@/app/api/v2/workflows/import/preview/route'
import { POST as importApply } from '@/app/api/v2/workflows/import/route'
import { POST as forkPreview } from '@/app/api/v2/workspaces/[workspaceId]/fork/preview/route'
import { POST as pushPreview } from '@/app/api/v2/workspaces/[workspaceId]/fork/push/preview/route'
import { POST as pushApply } from '@/app/api/v2/workspaces/[workspaceId]/fork/push/route'
import { POST as forkApply } from '@/app/api/v2/workspaces/[workspaceId]/fork/route'
import { GET as operationGet } from '@/app/api/v2/workspaces/[workspaceId]/operations/[operationId]/route'
import { GET as operationsList } from '@/app/api/v2/workspaces/[workspaceId]/operations/route'

const userId = generateId()
const workspaceId = generateId()
const personalKey = `sk-sim-fixture-${generateId()}`
const workspaceKey = `sk-sim-fixture-${generateId()}`
const logRunId = generateId()
const logSnapshotId = generateId()
const foreignWorkspaceId = generateId()
const logSnapshot = { blocks: {}, edges: [], variables: { fixture: 'configuration'.repeat(2000) } }
const childWorkspaceIds: string[] = []
let endpoint: string
let directory: string
let server: Server
let requestCount = 0
let corruptNextMutationResponse = false
const cliPath = resolve(process.cwd(), '../../packages/sim-cli/src/index.ts')
const source = {
  blocks: {
    start: {
      id: 'start',
      type: 'start_trigger',
      name: 'Start',
      enabled: true,
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
    },
  },
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
}

async function cli(args: string[], stdin?: string, key = personalKey) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(
      'bun',
      [
        '--no-env-file',
        cliPath,
        '--endpoint',
        endpoint,
        '--workspace',
        workspaceId,
        '--output',
        'json',
        ...args,
      ],
      {
        cwd: directory,
        env: { ...process.env, SIM_CONFIG_DIR: directory, SIM_API_KEY: key, NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolveResult({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

/** Exercises the real adapters/authentication over loopback HTTP and the installed CLI entrypoint. */
describe('v2 and CLI workflow protocol against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    directory = await mkdtemp(resolve(tmpdir(), 'sim-workflow-cli-'))
    await writeFile(resolve(directory, 'workflow.json'), JSON.stringify(source))
    await writeFile(resolve(directory, 'mappings.json'), '[]')
    await db.insert(user).values({
      id: userId,
      name: 'HTTP fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'HTTP fixture',
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    await db.insert(workspace).values({
      id: foreignWorkspaceId,
      name: 'Inaccessible log fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(workflowExecutionSnapshots).values({
      id: logSnapshotId,
      stateHash: generateId(),
      stateData: logSnapshot,
    })
    await db.insert(workflowExecutionLogs).values({
      id: generateId(),
      workspaceId,
      executionId: logRunId,
      stateSnapshotId: logSnapshotId,
      level: 'info',
      status: 'completed',
      trigger: 'manual',
      startedAt: now,
      endedAt: now,
      executionData: { finalOutput: { delivered: false }, traceSpans: [] },
    })
    await db.insert(apiKey).values([
      {
        id: generateId(),
        userId,
        name: 'Personal fixture',
        key: personalKey,
        keyHash: hashApiKey(personalKey),
        type: 'personal',
      },
      {
        id: generateId(),
        userId,
        workspaceId,
        name: 'Workspace fixture',
        key: workspaceKey,
        keyHash: hashApiKey(workspaceKey),
        type: 'workspace',
      },
    ])
    server = createServer(async (incoming, outgoing) => {
      try {
        requestCount++
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of incoming) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > 11 * 1024 * 1024) throw new Error('Fixture body limit exceeded')
          chunks.push(buffer)
        }
        const headers = new Headers()
        headers.set('x-forwarded-for', '127.0.0.1')
        for (const [name, value] of Object.entries(incoming.headers))
          if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        const request = new NextRequest(`${endpoint}${incoming.url}`, {
          method: incoming.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {}),
        })
        const path = new URL(request.url).pathname
        const match = path.match(/^\/api\/v2\/workspaces\/([^/]+)\/(.*)$/)
        const context = { params: Promise.resolve({ workspaceId: match?.[1] ?? workspaceId }) }
        const logMatch = path.match(/^\/api\/v2\/logs\/([^/]+)$/)
        const response = logMatch
          ? await logGet(request, { params: Promise.resolve({ runId: logMatch[1] }) })
          : path === '/api/v2/workflows/import/preview'
            ? await importPreview(request, { params: Promise.resolve({}) })
            : path === '/api/v2/workflows/import'
              ? await importApply(request, { params: Promise.resolve({}) })
              : match?.[2] === 'fork/preview'
                ? await forkPreview(request, context)
                : match?.[2] === 'fork'
                  ? await forkApply(request, context)
                  : match?.[2] === 'fork/push/preview'
                    ? await pushPreview(request, context)
                    : match?.[2] === 'fork/push'
                      ? await pushApply(request, context)
                      : match?.[2] === 'operations'
                        ? await operationsList(request, context)
                        : match?.[2].startsWith('operations/')
                          ? await operationGet(request, {
                              params: Promise.resolve({
                                workspaceId: match[1],
                                operationId: match[2].slice('operations/'.length),
                              }),
                            })
                          : new Response('Unknown fixture route', { status: 404 })
        outgoing.statusCode = response.status
        response.headers.forEach((value, name) => outgoing.setHeader(name, value))
        const body = await response.text()
        if (corruptNextMutationResponse && path === '/api/v2/workflows/import' && response.ok) {
          corruptNextMutationResponse = false
          outgoing.end('{')
        } else outgoing.end(body)
      } catch (error) {
        outgoing.statusCode = 500
        outgoing.end(JSON.stringify({ fixtureError: String(error) }))
      }
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind loopback')
    endpoint = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()))
        server.closeAllConnections()
      })
    for (const id of childWorkspaceIds) await db.delete(workspace).where(eq(workspace.id, id))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(workspace).where(eq(workspace.id, foreignWorkspaceId))
    await db
      .delete(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, logSnapshotId))
    await db.delete(user).where(eq(user.id, userId))
    await rm(directory, { recursive: true, force: true })
    await db.$client.end()
  })

  it('omits only the requested log snapshot through the CLI and preserves the default read', async () => {
    const args = ['logs', 'get', logRunId]
    const before = await cli(args)
    expect(before.code, before.stderr).toBe(0)
    const original = JSON.parse(before.stdout)
    expect(original.workflowState.variables).toEqual(logSnapshot.variables)

    const explicit = await cli([...args, '--include-workflow-state'])
    expect(explicit.code, explicit.stderr).toBe(0)
    expect(JSON.parse(explicit.stdout)).toEqual(original)
    const compact = await cli([...args, '--no-include-workflow-state'])
    expect(compact.code, compact.stderr).toBe(0)
    expect(JSON.parse(compact.stdout)).toEqual({ ...original, workflowState: null })
    expect(Buffer.byteLength(compact.stdout)).toBeLessThan(Buffer.byteLength(before.stdout) / 2)
    const after = await cli(args)
    expect(after.code, after.stderr).toBe(0)
    expect(JSON.parse(after.stdout)).toEqual(original)
  })

  it('validates log query flags and retains authorization for compact reads over HTTP', async () => {
    const path = `${endpoint}/api/v2/logs/${logRunId}`
    const headers = { 'X-API-Key': workspaceKey }
    const invalid = await fetch(`${path}?includeWorkflowState=invalid`, { headers })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } })
    const unknown = await fetch(`${path}?includeWorkflowState=false&unknown=true`, { headers })
    expect(unknown.status).toBe(400)
    const unauthenticated = await fetch(`${path}?includeWorkflowState=false`)
    expect(unauthenticated.status).toBe(401)

    await db
      .update(workflowExecutionLogs)
      .set({ workspaceId: foreignWorkspaceId })
      .where(eq(workflowExecutionLogs.executionId, logRunId))
    try {
      for (const query of ['', '?includeWorkflowState=false']) {
        const concealed = await fetch(`${path}${query}`, { headers })
        expect(concealed.status).toBe(404)
        expect(await concealed.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
      }
    } finally {
      await db
        .update(workflowExecutionLogs)
        .set({ workspaceId })
        .where(eq(workflowExecutionLogs.executionId, logRunId))
    }
  })

  it('previews stdin JSON, applies @file input, waits, and returns the same receipt on retry', async () => {
    const preview = await cli(
      ['workflows', 'import-preview', '--workflow', '@-', '--mappings', '@mappings.json'],
      JSON.stringify(source)
    )
    expect(preview.code, preview.stderr).toBe(0)
    const fingerprint = JSON.parse(preview.stdout).previewFingerprint as string
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    const requestId = generateId()
    const args = [
      'workflows',
      'import',
      '--workflow',
      '@workflow.json',
      '--mappings',
      '@mappings.json',
      '--preview-fingerprint',
      fingerprint,
      '--request-id',
      requestId,
      '--wait',
    ]
    const applied = await cli(args)
    expect(applied.code, applied.stderr).toBe(0)
    const report = JSON.parse(applied.stdout)
    expect(report).toMatchObject({ requestId, applied: true, status: 'completed' })
    const retry = await cli(args)
    expect(retry.code, retry.stderr).toBe(0)
    expect(JSON.parse(retry.stdout).operationId).toBe(report.operationId)
    const wait = await cli(['workspaces', 'operations', 'wait', report.operationId])
    expect(wait.code, wait.stderr).toBe(0)
    expect(
      await db
        .select()
        .from(workspaceOperationReceipt)
        .where(eq(workspaceOperationReceipt.requestId, requestId))
    ).toHaveLength(1)
  })

  it('retains the request ID after a committed response is corrupted and reconciles by retry', async () => {
    const preview = await cli([
      'workflows',
      'import-preview',
      '--workflow',
      '@workflow.json',
      '--mappings',
      '@mappings.json',
    ])
    expect(preview.code, preview.stderr).toBe(0)
    const requestId = generateId()
    const args = [
      'workflows',
      'import',
      '--workflow',
      '@workflow.json',
      '--mappings',
      '@mappings.json',
      '--preview-fingerprint',
      JSON.parse(preview.stdout).previewFingerprint,
      '--request-id',
      requestId,
    ]
    corruptNextMutationResponse = true
    const uncertain = await cli(args)
    expect(uncertain.code).toBe(1)
    expect(uncertain.stderr).toContain(requestId)
    expect(uncertain.stderr).toContain('MUTATION_OUTCOME_UNKNOWN')
    const retry = await cli(args)
    expect(retry.code, retry.stderr).toBe(0)
    expect(JSON.parse(retry.stdout)).toMatchObject({ requestId, applied: true })
    expect(
      await db
        .select()
        .from(workspaceOperationReceipt)
        .where(eq(workspaceOperationReceipt.requestId, requestId))
    ).toHaveLength(1)
  })

  it('requires a personal principal for fork administration and refuses unconfirmed sync before HTTP', async () => {
    const refused = await cli(['workspaces', 'fork-preview'], undefined, workspaceKey)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('WORKSPACE_KEY_OPERATION_NOT_PERMITTED')
    const before = requestCount
    const unconfirmed = await cli([
      'workspaces',
      'push',
      '--other-workspace-id',
      generateId(),
      '--preview-fingerprint',
      'a'.repeat(64),
      '--request-id',
      generateId(),
    ])
    expect(unconfirmed.code).toBe(1)
    expect(unconfirmed.stderr).toContain('--yes')
    expect(requestCount).toBe(before)
  })

  it('creates a draft fork and exposes the activated same-source comparison through the CLI', async () => {
    const [sourceWorkflow] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.workspaceId, workspaceId))
      .limit(1)
    const deployed = await performFullDeploy({ workflowId: sourceWorkflow.id, userId })
    expect(deployed.success).toBe(true)
    const preview = await cli(['workspaces', 'fork-preview', '--name', 'CLI fork fixture'])
    expect(preview.code, preview.stderr).toBe(0)
    const created = await cli([
      'workspaces',
      'fork',
      '--name',
      'CLI fork fixture',
      '--preview-fingerprint',
      JSON.parse(preview.stdout).previewFingerprint,
      '--request-id',
      generateId(),
      '--wait',
    ])
    expect(created.code, created.stderr).toBe(0)
    const report = JSON.parse(created.stdout)
    const childId = report.resourceIds[0] as string
    childWorkspaceIds.push(childId)
    const drafts = await db.select().from(workflow).where(eq(workflow.workspaceId, childId))
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.every((draft) => !draft.isDeployed)).toBe(true)
    const previewArgs = ['workspaces', 'push-preview', '--other-workspace-id', childId]
    const before = await cli(previewArgs)
    expect(before.code, before.stderr).toBe(0)
    const previewData = JSON.parse(before.stdout)
    expect(previewData.workflows[0]).toMatchObject({
      sourceWorkflowId: sourceWorkflow.id,
      comparison: { status: 'unavailable', reason: 'no_baseline' },
    })
    const pushed = await cli([
      'workspaces',
      'push',
      '--other-workspace-id',
      childId,
      '--preview-fingerprint',
      previewData.previewFingerprint,
      '--request-id',
      generateId(),
      '--yes',
    ])
    expect(pushed.code, pushed.stderr).toBe(0)
    const [receipt] = await db
      .select()
      .from(workspaceOperationReceipt)
      .where(eq(workspaceOperationReceipt.id, JSON.parse(pushed.stdout).operationId))
    const admitted = receipt.report as WorkspaceOperationReport
    const registry = { ...workflowDeploymentOutboxHandlers, ...workspaceOperationOutboxHandlers }
    for (const eventId of admitted.effectEventIds ?? [])
      expect(await processOutboxEventById(eventId, registry)).toBe('completed')
    const after = await cli(previewArgs)
    expect(after.code, after.stderr).toBe(0)
    const version = { id: deployed.deploymentVersionId, version: deployed.version }
    expect(JSON.parse(after.stdout).workflows[0]).toMatchObject({
      sourceWorkflowId: sourceWorkflow.id,
      comparison: { status: 'available', base: version, target: version },
    })
  })
})
