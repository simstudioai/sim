/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertPayload, mockExecuteMemberSync, mockTask } = vi.hoisted(() => ({
  mockAssertPayload: vi.fn(),
  mockExecuteMemberSync: vi.fn(),
  mockTask: vi.fn((config) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: mockTask,
  AbortTaskRunError: class AbortTaskRunError extends Error {},
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({
  MEMBER_SYNC_TASK_ID: 'knowledge-connector-member-sync',
  assertMemberSyncPayload: mockAssertPayload,
}))
vi.mock('@/lib/knowledge/connectors/member-sync-engine', () => ({
  executeMemberSync: mockExecuteMemberSync,
}))

import { AbortTaskRunError } from '@trigger.dev/sdk'
import {
  classifyMemberSyncResult,
  executeMemberSyncJob,
  knowledgeConnectorMemberSync,
} from '@/background/knowledge-connector-member-sync'

const RESULT = {
  docsAdded: 0,
  docsUpdated: 0,
  docsDeleted: 0,
  docsUnchanged: 0,
  docsSkipped: 0,
  docsFailed: 0,
  processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  membersClaimed: 2,
  membersCompleted: 2,
  membersIncomplete: 0,
  membersFailed: 0,
  membersRemaining: false,
  docsListed: 4,
  docsHydratedOnce: 4,
  observationsAdded: 4,
  observationsRemoved: 0,
  docsTombstoned: 0,
  docsResurrected: 0,
  docsPurged: 0,
  credentialsAudited: 2,
}

const PAYLOAD = {
  connectorId: 'c-1',
  requestId: 'r-1',
  billingAttribution: { workspaceId: 'ws-1' },
  dispatchToken: 't-1',
}

describe('knowledge connector member sync worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertPayload.mockReturnValue(PAYLOAD)
    mockExecuteMemberSync.mockResolvedValue(RESULT)
  })

  it('classifies outcomes from the run counters', () => {
    expect(classifyMemberSyncResult(RESULT)).toBe('completed')
    expect(classifyMemberSyncResult({ ...RESULT, membersIncomplete: 1 })).toBe('partial')
    expect(classifyMemberSyncResult({ ...RESULT, membersRemaining: true })).toBe('partial')
    expect(classifyMemberSyncResult({ ...RESULT, membersFailed: 1 })).toBe('partial')
    expect(classifyMemberSyncResult({ ...RESULT, docsFailed: 1 })).toBe('partial')
    expect(classifyMemberSyncResult({ ...RESULT, error: 'boom' })).toBe('failed')
    expect(classifyMemberSyncResult({ ...RESULT, skipReason: 'sync_in_progress' })).toBe('skipped')
  })

  it('runs the engine with the payload token and reports the outcome', async () => {
    await expect(executeMemberSyncJob(PAYLOAD)).resolves.toMatchObject({
      success: true,
      outcome: 'completed',
      connectorId: 'c-1',
      membersCompleted: 2,
    })
    expect(mockExecuteMemberSync).toHaveBeenCalledWith('c-1', {
      billingAttribution: PAYLOAD.billingAttribution,
      dispatchToken: 't-1',
    })
  })

  it('aborts rather than retries a failed run', async () => {
    mockExecuteMemberSync.mockResolvedValue({ ...RESULT, error: 'source down' })
    await expect(executeMemberSyncJob(PAYLOAD)).rejects.toBeInstanceOf(AbortTaskRunError)
  })

  it('reports a partial run without aborting, so members retry on their own ladder', async () => {
    mockExecuteMemberSync.mockResolvedValue({ ...RESULT, membersFailed: 1 })
    await expect(executeMemberSyncJob(PAYLOAD)).resolves.toMatchObject({
      success: false,
      outcome: 'partial',
    })
  })

  it('registers a single-attempt task on its own queue', () => {
    expect(knowledgeConnectorMemberSync).toMatchObject({
      id: 'knowledge-connector-member-sync',
      retry: { maxAttempts: 1 },
      queue: { name: 'connector-member-sync-queue' },
    })
  })
})
