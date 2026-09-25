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

import { executeWorkdayListWorkers } from '@/lib/internal/workday/operations'

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
})
