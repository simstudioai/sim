/**
 * The inbox and the overdue sweep filter calls with a SQL form of `isBackgroundDesktopToolCall`, so their
 * limits apply only to calls the desktop runs. Nothing else ties the two together: a desktop tool
 * added on one side only would silently drop out of the inbox and the sweep, or let Sim-only calls
 * crowd them. This runs one table of calls through both against real PostgreSQL and requires them
 * to agree on every case.
 */
import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listDesktopInboxRows } from '@/lib/desktop/executor/repository'
import { SIM_TOOL_EXECUTION_VERSION } from '@/lib/mothership/async-runs/lifecycle'
import {
  isBackgroundDesktopToolCall,
  NAMED_BACKGROUND_DESKTOP_TOOL_NAMES,
} from '@/lib/mothership/tools/desktop-tools'

interface ClassifierCase {
  label: string
  toolName: string
  args: Record<string, unknown>
}

const CASES: ClassifierCase[] = [
  { label: 'chat-view computer action', toolName: 'computer', args: { action: 'list_apps' } },
  ...NAMED_BACKGROUND_DESKTOP_TOOL_NAMES.map((toolName) => ({
    label: `named desktop tool ${toolName}`,
    toolName,
    args: {},
  })),
  ...(['read', 'grep'] as const).flatMap((toolName) => [
    { label: `${toolName} under user-local/`, toolName, args: { path: 'user-local/Project/a.md' } },
    { label: `${toolName} of user-local itself`, toolName, args: { path: 'user-local' } },
    {
      label: `${toolName} of user-local/ with a trailing slash`,
      toolName,
      args: { path: 'user-local/' },
    },
    {
      label: `${toolName} of a sibling user-localX/`,
      toolName,
      args: { path: 'user-localX/a.md' },
    },
    { label: `${toolName} of a LIKE-wildcard lookalike`, toolName, args: { path: 'user-local%' } },
    { label: `${toolName} of Sim's own files`, toolName, args: { path: 'workspace/notes.md' } },
    { label: `${toolName} with a numeric path`, toolName, args: { path: 5 } },
    { label: `${toolName} with an array path`, toolName, args: { path: ['user-local/a.md'] } },
    {
      label: `${toolName} with an object path`,
      toolName,
      args: { path: { value: 'user-local/a' } },
    },
    { label: `${toolName} with a null path`, toolName, args: { path: null } },
    { label: `${toolName} with no path`, toolName, args: {} },
    {
      label: `${toolName} with the local path under pattern instead`,
      toolName,
      args: { pattern: 'user-local/**' },
    },
  ]),
  { label: 'glob under user-local/', toolName: 'glob', args: { pattern: 'user-local/**/*.md' } },
  { label: 'glob of user-local itself', toolName: 'glob', args: { pattern: 'user-local' } },
  {
    label: 'glob of a sibling user-localX/',
    toolName: 'glob',
    args: { pattern: 'user-localX/**' },
  },
  { label: "glob of Sim's own files", toolName: 'glob', args: { pattern: '**/*.md' } },
  { label: 'glob with a numeric pattern', toolName: 'glob', args: { pattern: 7 } },
  { label: 'glob with no pattern', toolName: 'glob', args: {} },
  {
    label: 'glob with the local path under path instead',
    toolName: 'glob',
    args: { path: 'user-local/Project' },
  },
  { label: 'a non-desktop tool', toolName: 'run_workflow', args: {} },
  {
    label: 'a non-desktop tool with a local-looking path',
    toolName: 'edit_file',
    args: { path: 'user-local/a.md' },
  },
]

describe('desktop call classification in SQL and TypeScript', () => {
  const userId = generateId()
  const workspaceId = generateId()
  const deviceId = generateId()
  const chatId = generateId()
  const runId = generateId()
  /** Each case's call id, to read back which ones the SQL predicate admitted. */
  const callIds = new Map<string, ClassifierCase>()

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Classifier parity fixture',
      email: `${userId}@desktop-classifier.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Classifier parity fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(desktopDevices).values({
      id: deviceId,
      userId,
      name: 'Fixture Mac',
      appVersion: '0.9.0',
      platform: 'darwin-arm64',
      capabilities: { executor: 1 },
    })
    await db.insert(copilotChats).values({
      id: chatId,
      userId,
      workspaceId,
      type: 'mothership',
      conversationId: generateId(),
    })
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId: generateId(),
      toolExecutionVersion: SIM_TOOL_EXECUTION_VERSION,
      status: 'active',
      desktopDeviceId: deviceId,
    })
    for (const testCase of CASES) {
      const toolCallId = generateId()
      callIds.set(toolCallId, testCase)
      /** An offered, unclaimed call: the inbox lists it exactly when the SQL predicate admits it. */
      await db.insert(copilotAsyncToolCalls).values({
        runId,
        toolCallId,
        toolName: testCase.toolName,
        args: testCase.args,
        pickupDeadlineAt: sql`now() + interval '1 minute'`,
      })
    }
  })

  afterAll(async () => {
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.delete(desktopDevices).where(eq(desktopDevices.id, deviceId))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('agrees on every case, including the ones the desktop runs', async () => {
    const admittedBySql = new Set(
      (await listDesktopInboxRows({ deviceId, userId })).map((row) => row.toolCallId)
    )
    const verdicts = [...callIds].map(([toolCallId, testCase]) => ({
      case: testCase.label,
      sql: admittedBySql.has(toolCallId),
      typescript: isBackgroundDesktopToolCall(testCase.toolName, testCase.args),
    }))

    expect(verdicts.filter((verdict) => verdict.sql !== verdict.typescript)).toEqual([])
    expect(verdicts.find((verdict) => verdict.case === 'chat-view computer action')).toEqual({
      case: 'chat-view computer action',
      sql: false,
      typescript: false,
    })
    /** Both sides must also admit something, so agreement on "nothing" cannot pass. */
    expect(verdicts.filter((verdict) => verdict.typescript).length).toBeGreaterThan(
      NAMED_BACKGROUND_DESKTOP_TOOL_NAMES.length
    )
  })
})
