import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { quickbooksCreateEmployeeTool } from '@/tools/quickbooks/create_employee'
import type {
  QuickBooksCreateEmployeeParams,
  QuickBooksUpdateEmployeeParams,
} from '@/tools/quickbooks/types'
import { quickbooksUpdateEmployeeTool } from '@/tools/quickbooks/update_employee'

const auth = { accessToken: 'access-token', realmId: '123456789' }

beforeEach(() => setEnv({ QUICKBOOKS_ENV: 'sandbox' }))
afterEach(resetEnvMock)

describe('QuickBooks employee tools', () => {
  it('builds a bounded non-payroll employee create request', () => {
    const params: QuickBooksCreateEmployeeParams = {
      ...auth,
      displayName: ' Test Employee ',
      givenName: 'Test',
      familyName: 'Employee',
      primaryEmail: 'employee@example.com',
      primaryPhone: '555-0100',
      primaryAddress: { Line1: '1 Main St', City: 'San Francisco' },
      printOnCheckName: 'Test Employee',
      billableTime: false,
      requestId: 'employee-create-1',
    }
    const url = new URL(
      (
        quickbooksCreateEmployeeTool.request.url as (
          value: QuickBooksCreateEmployeeParams
        ) => string
      )(params)
    )
    expect(url.pathname).toBe('/v3/company/123456789/employee')
    expect(url.searchParams.get('requestid')).toBe('employee-create-1')
    expect(quickbooksCreateEmployeeTool.request.body!(params)).toEqual({
      DisplayName: 'Test Employee',
      GivenName: 'Test',
      FamilyName: 'Employee',
      PrimaryEmailAddr: { Address: 'employee@example.com' },
      PrimaryPhone: { FreeFormNumber: '555-0100' },
      PrimaryAddr: { Line1: '1 Main St', City: 'San Francisco' },
      PrintOnCheckName: 'Test Employee',
      BillableTime: false,
    })
  })

  it('builds a sparse update and rejects empty updates', () => {
    const params: QuickBooksUpdateEmployeeParams = {
      ...auth,
      employeeId: '12',
      syncToken: '1',
      activeStatus: 'inactive',
      billableTime: false,
    }
    expect(quickbooksUpdateEmployeeTool.request.body!(params)).toEqual({
      Id: '12',
      SyncToken: '1',
      sparse: true,
      BillableTime: false,
      Active: false,
    })
    expect(() =>
      quickbooksUpdateEmployeeTool.request.body!({
        ...auth,
        employeeId: '12',
        syncToken: '1',
        activeStatus: 'unchanged',
      })
    ).toThrow('Provide at least one field')
  })

  it('removes sensitive payroll fields while preserving operational fields', async () => {
    await expect(
      quickbooksCreateEmployeeTool.transformResponse!(
        Response.json({
          Employee: {
            Id: '12',
            SyncToken: '0',
            DisplayName: 'Test Employee',
            BillableTime: true,
            domain: 'QBO',
            SSN: '111-22-3333',
            TaxIdentifier: 'sensitive',
            EmployeeNumber: 'payroll-1',
          },
          time: 'test-time',
        })
      )
    ).resolves.toEqual({
      success: true,
      output: {
        record: {
          Id: '12',
          SyncToken: '0',
          DisplayName: 'Test Employee',
          BillableTime: true,
          domain: 'QBO',
        },
        recordId: '12',
        syncToken: '0',
        time: 'test-time',
      },
    })
  })
})
