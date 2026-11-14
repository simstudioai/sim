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

import {
  executeWorkdayCreatePrehire,
  executeWorkdayGetCompensation,
  executeWorkdayGetOrganizations,
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
    clientMocks.createWorkdaySoapClient.mockResolvedValue(CLIENT)
    for (const operation of Object.values(CLIENT)) operation.mockResolvedValue([{}])
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

  function firstCallArgs(mock: typeof clientMocks.Get_WorkersAsync): Record<string, unknown> {
    const call = mock.mock.calls[0]
    if (!call) throw new Error('Expected the SOAP operation to be called')
    return call[0] as Record<string, unknown>
  }

  it('reads compensation plans from the Worker_Compensation_DataType element names', async () => {
    clientMocks.Get_WorkersAsync.mockResolvedValue([
      {
        Response_Data: {
          Worker: {
            Worker_Data: {
              Compensation_Data: {
                Salary_and_Hourly_Data: {
                  Compensation_Plan_Reference: {
                    ID: { $value: 'base' },
                    attributes: { Descriptor: 'Base Pay' },
                  },
                  Amount: '120000',
                },
                Commission_Plan_Data: {
                  Compensation_Plan_Reference: { ID: { $value: 'commission' } },
                  Target_Amount: '15000',
                },
              },
            },
          },
        },
      },
    ])

    const result = await executeWorkdayGetCompensation({ ...CREDENTIALS, workerId: '04345' })

    expect(result.output.compensationPlans).toEqual([
      expect.objectContaining({ id: 'base', planName: 'Base Pay', amount: 120000 }),
      expect.objectContaining({ id: 'commission', amount: 15000 }),
    ])
  })

  it('reads the organization descriptor attribute and clamps the page size', async () => {
    clientMocks.Get_OrganizationsAsync.mockResolvedValue([
      {
        Response_Data: {
          Organization: {
            Organization_Reference: {
              ID: { $value: 'org-1' },
              attributes: { Descriptor: 'Engineering' },
            },
          },
        },
      },
    ])

    const result = await executeWorkdayGetOrganizations({ ...CREDENTIALS, limit: 5000 })

    expect(result.output.organizations[0]?.descriptor).toBe('Engineering')
    expect(firstCallArgs(clientMocks.Get_OrganizationsAsync).Response_Filter).toEqual({
      Page: 1,
      Count: 999,
    })
  })

  it('sends the organization type criteria before the response filter, in schema order', async () => {
    clientMocks.Get_OrganizationsAsync.mockResolvedValue([{ Response_Data: {} }])

    await executeWorkdayGetOrganizations({ ...CREDENTIALS, type: 'Supervisory' })

    expect(Object.keys(firstCallArgs(clientMocks.Get_OrganizationsAsync))).toEqual([
      'Request_Criteria',
      'Response_Filter',
      'Response_Group',
    ])
  })

  it('sends personal information changes under Change_Personal_Information_Data', async () => {
    await executeWorkdayUpdateWorker({
      ...CREDENTIALS,
      workerId: '04345',
      fields: { Marital_Status_Reference: 'Single' },
    })

    expect(firstCallArgs(clientMocks.Change_Personal_InformationAsync)).toHaveProperty(
      'Change_Personal_Information_Data.Personal_Information_Data',
      { Marital_Status_Reference: 'Single' }
    )
  })

  it('sends pre-hire contact data in schema order with a qualified Public attribute', async () => {
    await executeWorkdayCreatePrehire({
      ...CREDENTIALS,
      legalName: 'Ada Lovelace',
      email: 'ada@example.com',
      phoneNumber: '555-0100',
      address: '1 Main St',
    })

    const args = firstCallArgs(clientMocks.Put_ApplicantAsync) as {
      Applicant_Data: { Personal_Data: { Contact_Data: Record<string, unknown[]> } }
    }
    const contactData = args.Applicant_Data.Personal_Data.Contact_Data
    expect(Object.keys(contactData)).toEqual(['Address_Data', 'Phone_Data', 'Email_Address_Data'])
    expect(contactData.Address_Data?.[0]).toMatchObject({
      Address_Line_Data: { attributes: { 'wd:Type': 'ADDRESS_LINE_1' }, $value: '1 Main St' },
      Usage_Data: { attributes: { 'wd:Public': 'true' } },
    })
  })

  it('sends Last_Day_of_Work before the termination reason', async () => {
    await executeWorkdayTerminate({
      ...CREDENTIALS,
      workerId: '04345',
      terminationDate: '2026-12-01',
      reason: 'Resignation',
    })

    const args = firstCallArgs(clientMocks.Terminate_EmployeeAsync) as {
      Terminate_Employee_Data: { Terminate_Event_Data: Record<string, unknown> }
    }
    expect(Object.keys(args.Terminate_Employee_Data.Terminate_Event_Data)).toEqual([
      'Last_Day_of_Work',
      'Primary_Reason_Reference',
      'Notification_Date',
    ])
  })

  it('sends the Position_Details element the hire event requires', async () => {
    await executeWorkdayHire({
      ...CREDENTIALS,
      preHireId: 'APP-1',
      positionId: 'P-1',
      hireDate: '2026-12-01',
    })

    expect(firstCallArgs(clientMocks.Hire_EmployeeAsync)).toHaveProperty(
      'Hire_Employee_Data.Hire_Employee_Event_Data.Position_Details',
      {}
    )
  })
})
