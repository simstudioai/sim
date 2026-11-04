/** The failure message a browser-settled Copilot workflow tool reads back, against real PostgreSQL. */
import { db } from '@sim/db'
import {
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type { TraceSpan, WorkflowState } from '@/lib/logs/types'
import { getTrustedWorkflowToolExecution } from '@/lib/workflows/executor/execution-state'
import type { SerializableExecutionState } from '@/executor/execution/types'
import { emptyResolvedSecretTraceProvenance } from '@/executor/utils/resolved-secret-trace-registry'

const ids = {
  owner: `trusted-tool-failure-${generateId()}`,
  workspace: generateId(),
  workflow: generateId(),
}

const workflowState: WorkflowState = {
  blocks: {
    start: {
      id: 'start',
      type: 'starter',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
  },
  edges: [],
  loops: {},
  parallels: {},
}

function executionState(): SerializableExecutionState {
  return {
    blockStates: {},
    executedBlocks: ['start'],
    blockLogs: [],
    decisions: { router: {}, condition: {} },
    completedLoops: [],
    activeExecutionPath: [],
    resolvedSecretTraceProvenance: emptyResolvedSecretTraceProvenance(),
  }
}

/** Starts a run bound to a Copilot tool call, the way the browser settlement path launches one. */
async function startBoundRun() {
  const executionId = generateId()
  const toolCallId = generateId()
  const session = new LoggingSession(ids.workflow, executionId, 'manual', 'trusted-tool-failure')
  session.setTrustedExecutionCorrelation({
    executionId,
    requestId: 'trusted-tool-failure',
    source: 'workflow',
    workflowId: ids.workflow,
    triggerType: 'copilot',
    copilotToolCallId: toolCallId,
  })
  expect(
    await session.safeStart({ userId: ids.owner, workspaceId: ids.workspace, workflowState })
  ).toBe(true)
  return { session, executionId, toolCallId }
}

function readBack(run: { executionId: string; toolCallId: string }) {
  return getTrustedWorkflowToolExecution(run.executionId, ids.workflow, run.toolCallId)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Trusted Tool Failure',
    email: `${ids.owner}@trusted-tool-failure.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: ids.workspace,
    name: 'Trusted Tool Failure',
    ownerId: ids.owner,
    billedAccountUserId: ids.owner,
  })
  await db.insert(workflow).values({
    id: ids.workflow,
    userId: ids.owner,
    workspaceId: ids.workspace,
    name: 'Trusted Tool Failure',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
}, 30_000)

afterAll(async () => {
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, ids.workflow))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, ids.workflow))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspace))
  await db.delete(user).where(eq(user.id, ids.owner))
})

describe('trusted workflow tool execution failure message', () => {
  it('returns the message a run that threw was finalized with', async () => {
    const run = await startBoundRun()

    await run.session.safeCompleteWithError({
      error: { message: 'Fetch Orders: Request failed with status 404' },
      executionState: executionState(),
    })

    await expect(readBack(run)).resolves.toMatchObject({
      status: 'failed',
      contentAvailable: true,
      error: 'Fetch Orders: Request failed with status 404',
    })
  })

  it('returns no message for a run whose failed block left its own output', async () => {
    const run = await startBoundRun()
    const now = new Date().toISOString()
    const failedSpan: TraceSpan = {
      id: 'span-1',
      name: 'Check',
      type: 'function',
      duration: 1,
      startTime: now,
      endTime: now,
      status: 'error',
      output: { error: 'boom' },
    }

    await run.session.safeComplete({
      finalOutput: { error: 'a field the workflow returned' },
      traceSpans: [failedSpan],
      executionState: executionState(),
    })

    const result = await readBack(run)
    expect(result).toMatchObject({ status: 'failed', contentAvailable: true })
    expect(result).not.toHaveProperty('error')
  })
})
