import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksCreateEmployeeParams,
  QuickBooksEmployee,
  QuickBooksMutationResponse,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_EMPLOYEE_PROPERTIES,
  QUICKBOOKS_MUTATION_OUTPUTS,
} from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksEmployee,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  optionalQuickBooksString,
  parseQuickBooksAddress,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
} from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateEmployeeTool: ToolConfig<
  QuickBooksCreateEmployeeParams,
  QuickBooksMutationResponse<QuickBooksEmployee>
> = {
  id: 'quickbooks_create_employee',
  name: 'QuickBooks Create Employee',
  description: 'Create a non-payroll employee profile in the connected QuickBooks Online company',
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
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unique employee display name. When omitted QuickBooks derives it from the supplied name components, and it is read-only when QuickBooks Payroll is enabled',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee given name. At least one of givenName or familyName is required',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee family name. At least one of givenName or familyName is required',
    },
    primaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee primary email address',
    },
    primaryPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee primary phone number',
    },
    primaryAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee primary address',
    },
    printOnCheckName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee name printed on checks',
    },
    billableTime: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether employee time is billable',
    },
    requestId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Intuit idempotency request ID, up to 50 characters',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) =>
      addQuickBooksRequestId(
        buildQuickBooksEntityUrl(params, 'employee'),
        params.requestId
      ).toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      const givenName = optionalQuickBooksString(params.givenName)
      const familyName = optionalQuickBooksString(params.familyName)
      if (givenName === undefined && familyName === undefined) {
        throw new Error('At least one of givenName or familyName must be supplied')
      }
      return filterUndefined({
        DisplayName: optionalQuickBooksString(params.displayName),
        GivenName: givenName,
        FamilyName: familyName,
        PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
        PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
        PrimaryAddr: parseQuickBooksAddress(params.primaryAddress, 'primaryAddress'),
        PrintOnCheckName: optionalQuickBooksString(params.printOnCheckName),
        BillableTime: params.billableTime,
      })
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
      description: 'Created QuickBooks Employee record',
      properties: QUICKBOOKS_EMPLOYEE_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
