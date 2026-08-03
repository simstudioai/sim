import { filterUndefined } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
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
  optionalQuickBooksString,
  parseQuickBooksAddress,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
  requiredQuickBooksString,
  sanitizeQuickBooksEmployee,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
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
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique employee display name',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee given name',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee family name',
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
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) =>
      addQuickBooksRequestId(
        buildQuickBooksEntityUrl(params.realmId, 'employee'),
        params.requestId
      ).toString(),
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) =>
      filterUndefined({
        DisplayName: requiredQuickBooksString(params.displayName, 'displayName'),
        GivenName: optionalQuickBooksString(params.givenName),
        FamilyName: optionalQuickBooksString(params.familyName),
        PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
        PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
        PrimaryAddr: parseQuickBooksAddress(params.primaryAddress, 'primaryAddress'),
        PrintOnCheckName: optionalQuickBooksString(params.printOnCheckName),
        BillableTime: params.billableTime,
      }),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
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
