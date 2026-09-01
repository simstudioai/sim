/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeWorkdayAssignOnboarding: vi.fn(),
  executeWorkdayChangeJob: vi.fn(),
  executeWorkdayCreatePrehire: vi.fn(),
  executeWorkdayGetCompensation: vi.fn(),
  executeWorkdayGetOrganizations: vi.fn(),
  executeWorkdayGetWorker: vi.fn(),
  executeWorkdayHire: vi.fn(),
  executeWorkdayListWorkers: vi.fn(),
  executeWorkdayTerminate: vi.fn(),
  executeWorkdayUpdateWorker: vi.fn(),
}))

vi.mock('@/lib/internal/workday/operations', () => operationMocks)

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { WorkdayOperationError } from '@/lib/internal/workday/errors'
import { executeWorkdayTool } from '@/lib/internal/workday/execute-tool'

const CREDENTIALS = {
  tenantUrl: 'https://wd2-impl-services1.workday.com',
  tenant: 'example',
  username: 'user',
  password: 'not-a-real-password',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'workday_get_worker',
    input: { ...CREDENTIALS, workerId: 'worker-1' },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  [
    'workday_assign_onboarding',
    { ...CREDENTIALS, workerId: 'worker-1', onboardingPlanId: 'plan-1', actionEventId: 'event-1' },
    operationMocks.executeWorkdayAssignOnboarding,
  ],
  [
    'workday_change_job',
    {
      ...CREDENTIALS,
      workerId: 'worker-1',
      effectiveDate: '2026-08-27',
      reason: 'promotion',
    },
    operationMocks.executeWorkdayChangeJob,
  ],
  [
    'workday_create_prehire',
    { ...CREDENTIALS, legalName: 'Ada Lovelace', email: 'ada@example.com' },
    operationMocks.executeWorkdayCreatePrehire,
  ],
  [
    'workday_get_compensation',
    { ...CREDENTIALS, workerId: 'worker-1' },
    operationMocks.executeWorkdayGetCompensation,
  ],
  ['workday_get_organizations', CREDENTIALS, operationMocks.executeWorkdayGetOrganizations],
  [
    'workday_get_worker',
    { ...CREDENTIALS, workerId: 'worker-1' },
    operationMocks.executeWorkdayGetWorker,
  ],
  [
    'workday_hire_employee',
    {
      ...CREDENTIALS,
      preHireId: 'prehire-1',
      positionId: 'position-1',
      hireDate: '2026-08-27',
    },
    operationMocks.executeWorkdayHire,
  ],
  ['workday_list_workers', CREDENTIALS, operationMocks.executeWorkdayListWorkers],
  [
    'workday_terminate_worker',
    {
      ...CREDENTIALS,
      workerId: 'worker-1',
      terminationDate: '2026-08-27',
      reason: 'voluntary',
    },
    operationMocks.executeWorkdayTerminate,
  ],
  [
    'workday_update_worker',
    { ...CREDENTIALS, workerId: 'worker-1', fields: { Preferred_Name: 'Ada' } },
    operationMocks.executeWorkdayUpdateWorker,
  ],
] as const

describe('executeWorkdayTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ success: true, output: { toolId } })

    const response = await executeWorkdayTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, output: { toolId } })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeWorkdayTool(
      createRequest({ input: { ...CREDENTIALS, workerId: '' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeWorkdayGetWorker).not.toHaveBeenCalled()
  })

  it('rejects non-object operation input', async () => {
    const response = await executeWorkdayTool(createRequest({ input: '{' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeWorkdayGetWorker).not.toHaveBeenCalled()
  })

  it('preserves operation status and error envelopes', async () => {
    operationMocks.executeWorkdayCreatePrehire.mockRejectedValue(
      new WorkdayOperationError('Legal name must include both a first name and last name', 400)
    )

    const response = await executeWorkdayTool(
      createRequest({
        toolId: 'workday_create_prehire',
        input: { ...CREDENTIALS, legalName: 'Ada', email: 'ada@example.com' },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Legal name must include both a first name and last name',
    })
  })

  it('preserves unexpected provider errors', async () => {
    operationMocks.executeWorkdayGetWorker.mockRejectedValue(new Error('Workday unavailable'))

    const response = await executeWorkdayTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Workday unavailable',
    })
  })

  it('rejects unsupported Workday IDs without provider work', async () => {
    const response = await executeWorkdayTool(createRequest({ toolId: 'workday_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unsupported Workday tool: workday_unknown',
    })
    expect(operationMocks.executeWorkdayGetWorker).not.toHaveBeenCalled()
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeWorkdayTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeWorkdayGetWorker).not.toHaveBeenCalled()
  })
})
