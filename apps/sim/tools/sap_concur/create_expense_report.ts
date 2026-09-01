import type { CreateExpenseReportParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const createExpenseReportTool: InternalToolConfig<
  CreateExpenseReportParams,
  SapConcurResponse
> = {
  id: 'sap_concur_create_expense_report',
  name: 'SAP Concur Create Expense Report',
  description:
    'Create an expense report (POST /expensereports/v4/users/{userId}/context/{contextType}/reports — supported contexts: TRAVELER, PROXY). Required body fields: name, policyId.',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Concur user UUID who will own the report',
    },
    contextType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Access context: TRAVELER (creating own report) or PROXY (creating on behalf of another user)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Report payload — `name` and `policyId` are required. Optional fields: businessPurpose, comment, customData, countryCode, countrySubDivisionCode, etc.',
    },
  },
  operation: {
    input: (params) => {
      const userId = trimRequired(params.userId, 'userId')
      const contextType = trimRequired(params.contextType, 'contextType')
      return {
        ...baseSapConcurInput(params),
        path: `/expensereports/v4/users/${encodeURIComponent(userId)}/context/${encodeURIComponent(contextType)}/reports`,
        method: 'POST',
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Created expense report (Concur returns 201 with a URI to the new report)',
      properties: {
        uri: { type: 'string', description: 'URI of the newly created expense report' },
      },
    },
  },
}
