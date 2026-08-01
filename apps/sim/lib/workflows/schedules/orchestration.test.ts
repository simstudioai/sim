/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecordAudit, mockCaptureServerEvent } = vi.hoisted(() => ({
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { SCHEDULE_UPDATED: 'SCHEDULE_UPDATED' },
  AuditResourceType: { SCHEDULE: 'SCHEDULE' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import { performUpdateJob } from '@/lib/workflows/schedules/orchestration'

const BASE_JOB = {
  id: 'job-1',
  sourceWorkspaceId: 'workspace-1',
  sourceType: 'job',
  archivedAt: null,
  timezone: 'UTC',
  cronExpression: null,
  jobTitle: 'Nightly task',
  status: 'disabled',
}

describe('performUpdateJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('does not schedule a next run when editing time on a disabled job', async () => {
    queueTableRows(schemaMock.workflowSchedule, [{ ...BASE_JOB, status: 'disabled' }])

    const result = await performUpdateJob({
      jobId: 'job-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      time: '2099-01-01T09:00:00Z',
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set.mock.calls[0][0]).not.toHaveProperty('nextRunAt')
  })

  it('schedules the next run when editing time on an active job', async () => {
    queueTableRows(schemaMock.workflowSchedule, [{ ...BASE_JOB, status: 'active' }])

    const result = await performUpdateJob({
      jobId: 'job-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      time: '2099-01-01T09:00:00Z',
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({
      nextRunAt: new Date('2099-01-01T09:00:00Z'),
    })
  })
})
