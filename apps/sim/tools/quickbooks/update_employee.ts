import { ErrorExtractorId } from '@/tools/error-extractors'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  QuickBooksEmployee,
  QuickBooksMutationResponse,
  QuickBooksUpdateEmployeeParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_EMPLOYEE_PROPERTIES,
  QUICKBOOKS_MUTATION_OUTPUTS,
} from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksUpdateEmployeeTool: InternalToolConfig<
  QuickBooksUpdateEmployeeParams,
  QuickBooksMutationResponse<QuickBooksEmployee>
> = {
  id: 'quickbooks_update_employee',
  name: 'QuickBooks Update Employee',
  description: 'Read, merge, and full-update a non-payroll employee profile',
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
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Updated QuickBooks Employee record',
      properties: QUICKBOOKS_EMPLOYEE_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
