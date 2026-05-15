/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockRecordAudit,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { SCHEDULE_UPDATED: 'SCHEDULE_UPDATED' },
  AuditResourceType: { SCHEDULE: 'SCHEDULE' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
  workflowSchedule: {
    id: 'id',
    sourceWorkspaceId: 'sourceWorkspaceId',
    sourceType: 'sourceType',
    archivedAt: 'archivedAt',
    timezone: 'timezone',
    status: 'status',
    cronExpression: 'cronExpression',
    jobTitle: 'jobTitle',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

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

function mockExistingJob(job: typeof BASE_JOB) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue([job]),
      }),
    }),
  })
}

describe('performUpdateJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockUpdate.mockReturnValue({ set: mockUpdateSet })
    mockUpdateWhere.mockResolvedValue(undefined)
  })

  it('does not schedule a next run when editing time on a disabled job', async () => {
    mockExistingJob({ ...BASE_JOB, status: 'disabled' })

    const result = await performUpdateJob({
      jobId: 'job-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      time: '2099-01-01T09:00:00Z',
    })

    expect(result.success).toBe(true)
    expect(mockUpdateSet).toHaveBeenCalledTimes(1)
    expect(mockUpdateSet.mock.calls[0][0]).not.toHaveProperty('nextRunAt')
  })

  it('schedules the next run when editing time on an active job', async () => {
    mockExistingJob({ ...BASE_JOB, status: 'active' })

    const result = await performUpdateJob({
      jobId: 'job-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      time: '2099-01-01T09:00:00Z',
    })

    expect(result.success).toBe(true)
    expect(mockUpdateSet).toHaveBeenCalledTimes(1)
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      nextRunAt: new Date('2099-01-01T09:00:00Z'),
    })
  })
})
