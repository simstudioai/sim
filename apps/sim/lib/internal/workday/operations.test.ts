/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  Change_JobAsync: vi.fn(),
  Change_Personal_InformationAsync: vi.fn(),
  Get_OrganizationsAsync: vi.fn(),
  Get_WorkersAsync: vi.fn(),
  Hire_EmployeeAsync: vi.fn(),
  Put_ApplicantAsync: vi.fn(),
  Put_Onboarding_Plan_AssignmentAsync: vi.fn(),
  Terminate_EmployeeAsync: vi.fn(),
  createWorkdaySoapClient: vi.fn(),
}))

vi.mock('@/lib/internal/workday/client', () => ({
  createWorkdaySoapClient: clientMocks.createWorkdaySoapClient,
  extractRefId: (reference: { ID?: { $value?: string; _?: string } } | undefined) =>
    reference?.ID?.$value ?? reference?.ID?._ ?? null,
  normalizeSoapArray: <T>(value: T | T[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  parseSoapBoolean: (value: unknown) => {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    return null
  },
  parseSoapNumber: (value: unknown) => {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  },
  wdRef: (idType: string, idValue: string) => ({
    ID: { attributes: { 'wd:type': idType }, $value: idValue },
  }),
}))

import { WorkdayOperationError } from '@/lib/internal/workday/errors'
import {
  executeWorkdayAssignOnboarding,
  executeWorkdayChangeJob,
  executeWorkdayCreatePrehire,
  executeWorkdayGetCompensation,
  executeWorkdayGetOrganizations,
  executeWorkdayGetWorker,
  executeWorkdayHire,
  executeWorkdayListWorkers,
  executeWorkdayTerminate,
  executeWorkdayUpdateWorker,
} from '@/lib/internal/workday/operations'

const CREDENTIALS = {
  tenantUrl: 'https://wd2-impl-services1.workday.com',
  tenant: 'example',
  username: 'user',
  password: 'not-a-real-password',
}

const CLIENT = {
  Change_JobAsync: clientMocks.Change_JobAsync,
  Change_Personal_InformationAsync: clientMocks.Change_Personal_InformationAsync,
  Get_OrganizationsAsync: clientMocks.Get_OrganizationsAsync,
  Get_WorkersAsync: clientMocks.Get_WorkersAsync,
  Hire_EmployeeAsync: clientMocks.Hire_EmployeeAsync,
  Put_ApplicantAsync: clientMocks.Put_ApplicantAsync,
  Put_Onboarding_Plan_AssignmentAsync: clientMocks.Put_Onboarding_Plan_AssignmentAsync,
  Terminate_EmployeeAsync: clientMocks.Terminate_EmployeeAsync,
}

describe('Workday operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.createWorkdaySoapClient.mockResolvedValue(CLIENT)
    for (const operation of Object.values(CLIENT)) operation.mockResolvedValue([{}])
  })

  it.each([
    {
      name: 'get worker',
      service: 'humanResources',
      operation: clientMocks.Get_WorkersAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayGetWorker({ ...CREDENTIALS, workerId: 'worker-1' }, signal),
    },
    {
      name: 'list workers',
      service: 'humanResources',
      operation: clientMocks.Get_WorkersAsync,
      execute: (signal: AbortSignal) => executeWorkdayListWorkers(CREDENTIALS, signal),
    },
    {
      name: 'create prehire',
      service: 'recruiting',
      operation: clientMocks.Put_ApplicantAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayCreatePrehire(
          { ...CREDENTIALS, legalName: 'Ada Lovelace', email: 'ada@example.com' },
          signal
        ),
    },
    {
      name: 'hire',
      service: 'staffing',
      operation: clientMocks.Hire_EmployeeAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayHire(
          {
            ...CREDENTIALS,
            preHireId: 'prehire-1',
            positionId: 'position-1',
            hireDate: '2026-08-27',
          },
          signal
        ),
    },
    {
      name: 'update worker',
      service: 'humanResources',
      operation: clientMocks.Change_Personal_InformationAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayUpdateWorker(
          { ...CREDENTIALS, workerId: 'worker-1', fields: { Preferred_Name: 'Ada' } },
          signal
        ),
    },
    {
      name: 'assign onboarding',
      service: 'humanResources',
      operation: clientMocks.Put_Onboarding_Plan_AssignmentAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayAssignOnboarding(
          {
            ...CREDENTIALS,
            workerId: 'worker-1',
            onboardingPlanId: 'plan-1',
            actionEventId: 'event-1',
          },
          signal
        ),
    },
    {
      name: 'get organizations',
      service: 'humanResources',
      operation: clientMocks.Get_OrganizationsAsync,
      execute: (signal: AbortSignal) => executeWorkdayGetOrganizations(CREDENTIALS, signal),
    },
    {
      name: 'change job',
      service: 'staffing',
      operation: clientMocks.Change_JobAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayChangeJob(
          {
            ...CREDENTIALS,
            workerId: 'worker-1',
            effectiveDate: '2026-08-27',
            reason: 'promotion',
          },
          signal
        ),
    },
    {
      name: 'get compensation',
      service: 'humanResources',
      operation: clientMocks.Get_WorkersAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayGetCompensation({ ...CREDENTIALS, workerId: 'worker-1' }, signal),
    },
    {
      name: 'terminate',
      service: 'staffing',
      operation: clientMocks.Terminate_EmployeeAsync,
      execute: (signal: AbortSignal) =>
        executeWorkdayTerminate(
          {
            ...CREDENTIALS,
            workerId: 'worker-1',
            terminationDate: '2026-08-27',
            reason: 'voluntary',
          },
          signal
        ),
    },
  ])('dispatches $name through the typed SOAP client', async ({ service, operation, execute }) => {
    const controller = new AbortController()

    await execute(controller.signal)

    expect(clientMocks.createWorkdaySoapClient).toHaveBeenCalledWith(
      CREDENTIALS.tenantUrl,
      CREDENTIALS.tenant,
      service,
      CREDENTIALS.username,
      CREDENTIALS.password,
      controller.signal
    )
    expect(operation).toHaveBeenCalledOnce()
  })

  it('maps singleton workers and preserves pagination semantics', async () => {
    clientMocks.Get_WorkersAsync.mockResolvedValue([
      {
        Response_Data: {
          Worker: {
            Worker_Reference: { ID: { $value: 'worker-1' } },
            Worker_Descriptor: 'Ada Lovelace',
            Worker_Data: {
              Personal_Data: { name: 'Ada' },
              Employment_Data: { status: 'active' },
            },
          },
        },
        Response_Results: { Total_Results: '42' },
      },
    ])

    const result = await executeWorkdayListWorkers({ ...CREDENTIALS, limit: 10, offset: 20 })

    expect(clientMocks.Get_WorkersAsync).toHaveBeenCalledWith({
      Response_Filter: { Page: 3, Count: 10 },
      Response_Group: {
        Include_Reference: true,
        Include_Personal_Information: true,
        Include_Employment_Information: true,
      },
    })
    expect(result).toEqual({
      success: true,
      output: {
        workers: [
          {
            id: 'worker-1',
            descriptor: 'Ada Lovelace',
            personalData: { name: 'Ada' },
            employmentData: { status: 'active' },
          },
        ],
        total: 42,
      },
    })
  })

  it('flattens and normalizes compensation plans', async () => {
    clientMocks.Get_WorkersAsync.mockResolvedValue([
      {
        Response_Data: {
          Worker: {
            Worker_Data: {
              Compensation_Data: {
                Employee_Base_Pay_Plan_Assignment_Data: {
                  Compensation_Plan_Reference: {
                    ID: { $value: 'base-plan' },
                    attributes: { Descriptor: 'Base Pay' },
                  },
                  Amount: '125000',
                  Currency_Reference: { ID: { $value: 'USD' } },
                  Frequency_Reference: { ID: { $value: 'Annual' } },
                },
                Employee_Bonus_Plan_Assignment_Data: [
                  {
                    Compensation_Plan_Reference: { ID: { $value: 'bonus-plan' } },
                    Individual_Target_Amount: '15000',
                  },
                ],
              },
            },
          },
        },
      },
    ])

    const result = await executeWorkdayGetCompensation({
      ...CREDENTIALS,
      workerId: 'worker-1',
    })

    expect(result.output.compensationPlans).toEqual([
      {
        id: 'base-plan',
        planName: 'Base Pay',
        amount: 125000,
        currency: 'USD',
        frequency: 'Annual',
      },
      {
        id: 'bonus-plan',
        planName: null,
        amount: 15000,
        currency: null,
        frequency: null,
      },
    ])
  })

  it('maps organization activity and total values', async () => {
    clientMocks.Get_OrganizationsAsync.mockResolvedValue([
      {
        Response_Data: {
          Organization: {
            Organization_Reference: { ID: { $value: 'org-1' } },
            Organization_Descriptor: 'Engineering',
            Organization_Data: {
              Organization_Type_Reference: { ID: { $value: 'Department' } },
              Organization_Subtype_Reference: { ID: { $value: 'Product' } },
              Inactive: 'false',
            },
          },
        },
        Response_Results: { Total_Results: '1' },
      },
    ])

    const result = await executeWorkdayGetOrganizations({
      ...CREDENTIALS,
      type: 'Department',
    })

    expect(result.output).toEqual({
      organizations: [
        {
          id: 'org-1',
          descriptor: 'Engineering',
          type: 'Department',
          subtype: 'Product',
          isActive: true,
        },
      ],
      total: 1,
    })
  })

  it('rejects invalid prehire contact data before creating a client', async () => {
    await expect(
      executeWorkdayCreatePrehire({ ...CREDENTIALS, legalName: 'Ada Lovelace' })
    ).rejects.toEqual(
      new WorkdayOperationError(
        'At least one contact method (email, phone, or address) is required',
        400
      )
    )
    expect(clientMocks.createWorkdaySoapClient).not.toHaveBeenCalled()
  })

  it('propagates cancellation before client creation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeWorkdayGetWorker({ ...CREDENTIALS, workerId: 'worker-1' }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(clientMocks.createWorkdaySoapClient).not.toHaveBeenCalled()
  })
})
