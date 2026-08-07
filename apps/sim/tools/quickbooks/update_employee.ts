import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksEmployee,
  QuickBooksMutationResponse,
  QuickBooksUpdateEmployeeParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_EMPLOYEE_PROPERTIES,
  QUICKBOOKS_MUTATION_OUTPUTS,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksEmployee,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  parseQuickBooksAddress,
  quickBooksActiveValue,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
  requiredQuickBooksString,
} from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdateEmployeeTool: ToolConfig<
  QuickBooksUpdateEmployeeParams,
  QuickBooksMutationResponse<QuickBooksEmployee>
> = {
  id: 'quickbooks_update_employee',
  name: 'QuickBooks Update Employee',
  description:
    'Sparse-update a non-payroll employee profile in the connected QuickBooks Online company',
  version: '1.0.0',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID derived from the connected credential',
    },
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the employee to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current employee sync token',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement employee display name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement employee given name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement employee family name',
    },
    primaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement employee primary email address',
    },
    primaryPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement employee primary phone number',
    },
    primaryAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement employee primary address',
    },
    printOnCheckName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement employee name printed on checks',
    },
    billableTime: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether employee time is billable',
    },
    activeStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'unchanged',
      description: 'Employee status change: unchanged, active, or inactive',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => buildQuickBooksEntityUrl(params.realmId, 'employee').toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const body = filterUndefined({
        Id: requiredQuickBooksString(params.employeeId, 'employeeId'),
        SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
        sparse: true,
        DisplayName: optionalQuickBooksString(params.displayName),
        GivenName: optionalQuickBooksString(params.givenName),
        FamilyName: optionalQuickBooksString(params.familyName),
        PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
        PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
        PrimaryAddr: parseQuickBooksAddress(params.primaryAddress, 'primaryAddress'),
        PrintOnCheckName: optionalQuickBooksString(params.printOnCheckName),
        BillableTime: params.billableTime,
        Active: quickBooksActiveValue(params.activeStatus),
      }) as Record<string, unknown>
      assertQuickBooksSparseUpdate(body)
      return body
    },
    retry: { enabled: false },
  },
  transformResponse: (response) =>
    transformQuickBooksMutationResponse<QuickBooksEmployee>(
      response,
      'Employee',
      sanitizeQuickBooksEmployee
    ),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated QuickBooks Employee record',
      properties: QUICKBOOKS_EMPLOYEE_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
